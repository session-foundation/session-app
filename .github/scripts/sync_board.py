#!/usr/bin/env python3
"""
Keeps the project board in step with the repo, so nobody moves cards by hand.

- Every issue is on the board, and every pull request from when it is open: one closed before the
  board existed is history nobody plans with.
- A pull request's Status follows it: draft or changes requested is In progress, ready is In review,
  approved is Approved, merged or closed is Done.
- An issue with an open pull request that will close it takes that pull request's Status.
- Any other open issue is Ready when nothing it is blocked by is still open and it is scheduled for an
  app release (it has a milestone), and Backlog otherwise, which keeps an unsorted user report out of
  Ready until triage gives it a milestone. One someone moved to In progress by hand is left there;
  one the sync moved there for a pull request goes back once that pull request no longer closes it.
- "Waiting on" lists the open issues an issue is blocked by.
- "Release" mirrors each issue's milestone as a single-select, so a view grouped by it lists the
  releases in the order of the field's options, which people set by dragging them in the field's
  settings: a milestone view can only sort by due date. A milestone with no option gets one at the
  end, one that is gone loses its option, and a renamed one keeps its option and place.

Items from other repositories are kept in step too, each looked up in its own repository. Only this
repository's issues and open pull requests are added automatically, and only its issues have a
Release, which mirrors this repository's milestones.

Closing a release's milestone folds the closed issues of Next into it (FOLD_INTO=<title>): fixes
made between releases ship with the release that follows them. That run does only the fold: the
milestones it changes start ordinary syncs.

- "Rank" orders the work for the views that sort by it, lowest first: by Status (what's nearly done
  first, then what can be picked up, then what's waiting), then release (in the Release field's
  order), then Priority, then the fewest open blockers, then the most open issues it unblocks, then
  the easiest.
- An archived item is left alone, since GitHub refuses any change to one, unless its issue or pull
  request is open: anything open is work, so it is unarchived and kept in step again.

Blocked-by links fire no event, so the workflow also runs on a schedule. With POST_STATUS=1 it
posts a progress update to the project instead.
"""
import json
import os
import subprocess
import sys
import time

REPO = os.environ['REPO']
OWNER = os.environ['PROJECT_OWNER']
NUMBER = int(os.environ['PROJECT_NUMBER'])
OWNER_KIND = os.environ.get('PROJECT_OWNER_KIND', 'user')
AREA_LABEL = 'area'
# Fixes between releases, folded into the next release when it closes.
NEXT = 'Next'
ORDER = ['Backlog', 'Ready', 'In progress', 'In review', 'Approved', 'Done']
# A hidden text field holding the Status the sync last decided for an issue, which is how an In
# progress set by hand is told from one the sync set for a pull request.
SYNCED = 'Synced status'
RANK = 'Rank'
REQUIRED_FIELDS = ['Status', 'Waiting on', 'Release', SYNCED, RANK]
# Rank's order, lowest first. Approved and In review are nearly done, so they lead.
RANK_STATUS = ['Approved', 'In review', 'In progress', 'Ready', 'Backlog', 'Done']
RANK_PRIORITY = ['P0', 'P1', 'P2']


def gh(args, payload=None):
    for attempt in range(4):
        out = subprocess.run(['gh', *args], input=None if payload is None else json.dumps(payload),
                             capture_output=True, text=True)
        # GitHub's GraphQL endpoint fails now and then with a generic error that a retry clears. Only
        # a failed call is retried: a successful response can quote the phrase in an issue's text.
        if out.returncode != 0 and 'Something went wrong' in out.stdout + out.stderr and attempt < 3:
            time.sleep(3 * (attempt + 1))
            continue
        if out.returncode != 0:
            sys.exit(f'gh {" ".join(args[:3])} failed: {out.stdout} {out.stderr}')
        return out.stdout


def gql(query, tolerated=(), **variables):
    """Fails on any error, except those whose path runs through a field named in tolerated, which
    are logged: GraphQL nulls that part and still answers the rest."""
    data = json.loads(gh(['api', 'graphql', '--input', '-'], {'query': query, 'variables': variables}))
    errors = data.get('errors') or []
    if fatal := [e for e in errors if not set(e.get('path') or []) & set(tolerated)]:
        sys.exit(json.dumps(fatal))
    for e in errors:
        print(f'warning: {e.get("message")} at {"/".join(map(str, e["path"]))}')
    return data['data']


def rest(path):
    return json.loads(gh(['api', '--paginate', '--slurp', path]))


PROJECT = gql(
    f'query($o:String!,$n:Int!){{{OWNER_KIND}(login:$o){{projectV2(number:$n){{id fields(first:50){{nodes{{'
    '... on ProjectV2FieldCommon{id name} ... on ProjectV2SingleSelectField{options{id name color description}}}}}}}',
    o=OWNER, n=NUMBER)[OWNER_KIND]['projectV2']
PID = PROJECT['id']
FIELDS = {f['name']: f for f in PROJECT['fields']['nodes'] if f}
if missing := [name for name in REQUIRED_FIELDS if name not in FIELDS]:
    sys.exit(f'The project is missing the fields {", ".join(missing)}: see docs/PROJECT.md.')
STATUS = FIELDS['Status']
OPTION = {o['name']: o['id'] for o in STATUS['options']}

ITEMS_QUERY = '''query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){
  pageInfo{hasNextPage endCursor}
  nodes{id isArchived
    status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
    priority:fieldValueByName(name:"Priority"){... on ProjectV2ItemFieldSingleSelectValue{name}}
    difficulty:fieldValueByName(name:"Difficulty"){... on ProjectV2ItemFieldSingleSelectValue{name}}
    rank:fieldValueByName(name:"Rank"){... on ProjectV2ItemFieldNumberValue{number}}
    waiting:fieldValueByName(name:"Waiting on"){... on ProjectV2ItemFieldTextValue{text}}
    release:fieldValueByName(name:"Release"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
    synced:fieldValueByName(name:"Synced status"){... on ProjectV2ItemFieldTextValue{text}}
    content{
      ... on Issue{__typename id number state repository{nameWithOwner} milestone{title}
        labels(first:20){nodes{name}}
        blockedBy(first:50){nodes{number title state repository{nameWithOwner}}}}
      ... on PullRequest{__typename id number state isDraft reviewDecision repository{nameWithOwner}
        closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}}}}}}}}'''


def items():
    found, after = [], None
    while True:
        # A blocker in a repository the app can't read costs only that blocker, not the run.
        page = gql(ITEMS_QUERY, tolerated=('blockedBy',), p=PID, after=after)['node']['items']
        found += [i for i in page['nodes'] if i['content']]
        if not page['pageInfo']['hasNextPage']:
            return found
        after = page['pageInfo']['endCursor']


def set_status(item, name):
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,'
        'itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
        p=PID, i=item['id'], f=STATUS['id'], o=OPTION[name])


def set_text(item, field, text):
    if text:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$t:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,'
            'itemId:$i,fieldId:$f,value:{text:$t}}){projectV2Item{id}}}',
            p=PID, i=item['id'], f=FIELDS[field]['id'], t=text)
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!){clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,'
            'fieldId:$f}){projectV2Item{id}}}', p=PID, i=item['id'], f=FIELDS[field]['id'])


def set_number(item, field, number):
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$n:Float!){updateProjectV2ItemFieldValue(input:{projectId:$p,'
        'itemId:$i,fieldId:$f,value:{number:$n}}){projectV2Item{id}}}',
        p=PID, i=item['id'], f=FIELDS[field]['id'], n=number)


def rank(status, release, priority, difficulty, blockers, unblocks):
    """
    One number for an order a view can't express itself, lowest first. Each part has its own digits,
    so an earlier part always outweighs every later one: status, release (its place in the Release
    field's order, so a later release's P0 never comes before the next one's P1), priority, open
    blockers (fewest first), open issues it unblocks (most first), difficulty (easiest first).
    """
    s = RANK_STATUS.index(status) if status in RANK_STATUS else len(RANK_STATUS)
    p = next((at for at, name in enumerate(RANK_PRIORITY) if (priority or '').startswith(name)),
             len(RANK_PRIORITY))
    d = int(difficulty[0]) if difficulty and difficulty[0].isdigit() else 6
    return (s * 10**8 + min(release, 99) * 10**6 + p * 10**5 + min(blockers, 99) * 10**3
            + (99 - min(unblocks, 99)) * 10 + d)


def repo_of(content):
    return content['repository']['nameWithOwner']


def ref(issue_repo, number):
    """How Waiting on names an issue: by number in this repository, with its repository elsewhere."""
    return f'#{number}' if issue_repo == REPO else f'{issue_repo}#{number}'


MILESTONE_TAG = 'Milestone #'


def sync_release_options():
    """
    Keeps one Release option per milestone, in the order people gave them and with each option's id
    (so no issue loses its value). An option names its milestone's number in its description, so a
    renamed milestone keeps its option and its place; one for a milestone with no option goes at the
    end, and one whose milestone is gone is dropped. Returns the option id for each milestone title,
    and the titles in the field's order.
    """
    field = FIELDS['Release']
    milestones = [m for page in rest(f'repos/{REPO}/milestones?state=all&per_page=100') for m in page]
    by_number = {m['number']: m for m in milestones}
    by_title = {m['title']: m for m in milestones}

    def milestone_of(option):
        description = option.get('description') or ''
        if description.startswith(MILESTONE_TAG) and description[len(MILESTONE_TAG):].isdigit():
            return by_number.get(int(description[len(MILESTONE_TAG):]))
        return by_title.get(option['name'])

    def wanted(milestone, option=None):
        kept = {} if option is None else {'id': option['id'], 'color': option.get('color') or 'GRAY'}
        return {'color': 'GRAY', **kept, 'name': milestone['title'],
                'description': f"{MILESTONE_TAG}{milestone['number']}"}

    options, seen = [], set()
    for option in field['options']:
        milestone = milestone_of(option)
        if milestone is not None and milestone['number'] not in seen:
            seen.add(milestone['number'])
            options.append(wanted(milestone, option))
    for m in sorted(milestones, key=lambda m: (m['title'] == NEXT, m['number'])):
        if m['number'] not in seen:
            options.append(wanted(m))

    def shape(o):
        return (o.get('id'), o['name'], o.get('description') or '')

    # With no milestones yet there is nothing to mirror, and a single select can't be left empty.
    if options and [shape(o) for o in options] != [shape(o) for o in field['options']]:
        updated = gql('mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field('
                      'input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on '
                      'ProjectV2SingleSelectField{options{id name color description}}}}}',
                      f=field['id'], o=options)
        field['options'] = updated['updateProjectV2Field']['projectV2Field']['options']
    ordered = [o['name'] for o in field['options']]
    return {o['name']: o['id'] for o in field['options']}, ordered


def set_release(item, option):
    field = FIELDS['Release']['id']
    if option is None:
        gql('mutation($p:ID!,$i:ID!,$f:ID!){clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,'
            'fieldId:$f}){projectV2Item{id}}}', p=PID, i=item['id'], f=field)
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,'
            'itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
            p=PID, i=item['id'], f=field, o=option)


def pr_status(pr):
    if pr['state'] != 'OPEN':
        return 'Done'
    if pr['isDraft'] or pr['reviewDecision'] == 'CHANGES_REQUESTED':
        return 'In progress'
    if pr['reviewDecision'] == 'APPROVED':
        return 'Approved'
    return 'In review'


def sync():
    on_board = {i['content']['id'] for i in items()}
    added = False
    for page in rest(f'repos/{REPO}/issues?state=all&per_page=100'):
        for issue in page:
            # The issues endpoint lists pull requests too
            if 'pull_request' in issue and issue['state'] != 'open':
                continue
            if issue['node_id'] not in on_board:
                gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
                    p=PID, c=issue['node_id'])
                print(f'added #{issue["number"]}')
                added = True

    # A card just added is missing from the next read for a moment.
    if added:
        time.sleep(5)
    board = items()
    for item in board:
        content = item['content']
        if item['isArchived'] and content['state'] == 'OPEN':
            # Anything open is work, so it is always on the board: reopened since it was archived, or
            # archived by hand while open
            gql('mutation($p:ID!,$i:ID!){unarchiveProjectV2Item(input:{projectId:$p,itemId:$i}){item{id}}}',
                p=PID, i=item['id'])
            item['isArchived'] = False
            print(f'unarchived {ref(repo_of(content), content["number"])}')
    # GitHub refuses any change to an archived item
    board = [i for i in board if not i['isArchived']]
    # Keyed by repository and number: the board can hold another repository's issues and PRs.
    closing = {}
    for i in board:
        pr = i['content']
        if pr['__typename'] == 'PullRequest' and pr['state'] == 'OPEN':
            for issue in pr['closingIssuesReferences']['nodes']:
                closing.setdefault((repo_of(issue), issue['number']), []).append(pr)

    release_options, release_order = sync_release_options()
    for item in board:
        content = item['content']
        if content['__typename'] != 'Issue' or repo_of(content) != REPO:
            continue
        wanted = None if content['milestone'] is None else release_options.get(content['milestone']['title'])
        if wanted != (item['release'] or {}).get('optionId'):
            set_release(item, wanted)

    ranked = []                     # (item, status, open blocker count)
    unblocks = {}                   # (repo, number) -> how many open issues it blocks
    for item in board:
        content = item['content']
        repo = repo_of(content)
        current = (item['status'] or {}).get('name')
        synced = (item['synced'] or {}).get('text') or ''
        decided = False
        if content['__typename'] == 'PullRequest':
            wanted, waiting = pr_status(content), ''
        elif AREA_LABEL in [l['name'] for l in content['labels']['nodes']]:
            continue
        else:
            blockers = [] if content['state'] != 'OPEN' else [
                b for b in ((content['blockedBy'] or {}).get('nodes') or []) if b and b['state'] == 'OPEN']
            waiting = ', '.join(f'{ref(repo_of(b), b["number"])} {b["title"][:48]}' for b in blockers)
            for b in blockers:
                key = (repo_of(b), b['number'])
                unblocks[key] = unblocks.get(key, 0) + 1
            prs = closing.get((repo, content['number']))
            decided = True
            if content['state'] != 'OPEN':
                wanted = 'Done'
            elif prs:
                wanted = max((pr_status(pr) for pr in prs), key=ORDER.index)
            elif current == 'In progress' and synced != 'In progress':
                # Set by hand, for work started before there is a pull request: left, and not recorded
                # as the sync's, so it stays until someone moves it or a pull request takes over.
                wanted, decided = current, False
            elif blockers or content['milestone'] is None:
                wanted = 'Backlog'
            else:
                wanted = 'Ready'
        if wanted != current:
            set_status(item, wanted)
            print(f'{ref(repo, content["number"])}: {current} -> {wanted}')
        if decided and wanted != synced:
            set_text(item, SYNCED, wanted)
        if waiting != ((item['waiting'] or {}).get('text') or ''):
            set_text(item, 'Waiting on', waiting)
        ranked.append((item, wanted, len(blockers) if content['__typename'] == 'Issue' else 0))

    for item, status, blockers in ranked:
        content = item['content']
        # Unscheduled work, another repository's issues and pull requests come after every release
        milestone = (content.get('milestone') or {}).get('title') if repo_of(content) == REPO else None
        release = release_order.index(milestone) if milestone in release_order else len(release_order)
        value = rank(status, release, (item['priority'] or {}).get('name'),
                     (item['difficulty'] or {}).get('name'), blockers,
                     unblocks.get((repo_of(content), content['number']), 0))
        if value != (item['rank'] or {}).get('number'):
            set_number(item, RANK, value)


def post_status():
    lines = ['**Where the project is up to**', '', '| Release | Done | Progress |', '| --- | --- | --- |']
    milestones = [m for page in rest(f'repos/{REPO}/milestones?state=all&per_page=100') for m in page]
    # In the order of the Release field's options, which is the order people gave the releases. Read,
    # not rewritten: this run can overlap a sync, which is what keeps the options in step.
    ordered = [o['name'] for o in FIELDS['Release']['options']]
    rank = {title: at for at, title in enumerate(ordered)}
    for m in sorted(milestones, key=lambda m: (rank.get(m['title'], len(rank)), m['number'])):
        total = m['open_issues'] + m['closed_issues']
        pct = round(100 * m['closed_issues'] / total) if total else 0
        lines.append(f"| {m['title']} | {m['closed_issues']} of {total} | {'█' * (pct // 10)}{'░' * (10 - pct // 10)} {pct}% |")
    lines += ['', '| Area | Done |', '| --- | --- |']
    for page in rest(f'repos/{REPO}/issues?labels={AREA_LABEL}&state=all&per_page=100'):
        for issue in page:
            s = issue.get('sub_issues_summary') or {}
            lines.append(f"| {issue['title']} | {s.get('completed', 0)} of {s.get('total', 0)} ({s.get('percent_completed', 0)}%) |")
    gql('mutation($p:ID!,$b:String!){createProjectV2StatusUpdate(input:{projectId:$p,body:$b}){statusUpdate{id}}}',
        p=PID, b='\n'.join(lines))
    print('posted a status update')


def fold_next(into):
    """Moves Next's closed issues into the release whose milestone just closed."""
    if into == NEXT:
        return
    milestones = {m['title']: m['number'] for page in rest(f'repos/{REPO}/milestones?state=all&per_page=100') for m in page}
    if NEXT not in milestones or into not in milestones:
        return
    for page in rest(f'repos/{REPO}/issues?milestone={milestones[NEXT]}&state=closed&per_page=100'):
        for issue in page:
            if 'pull_request' in issue:
                continue
            gh(['api', '-X', 'PATCH', f'repos/{REPO}/issues/{issue["number"]}', '-F', f'milestone={milestones[into]}'])
            print(f'#{issue["number"]}: {NEXT} -> {into}')


if __name__ == '__main__':
    if os.environ.get('FOLD_INTO'):
        fold_next(os.environ['FOLD_INTO'])
    elif os.environ.get('POST_STATUS') == '1':
        post_status()
    else:
        sync()

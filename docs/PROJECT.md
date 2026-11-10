# The project board

The work on Session is planned on the organization's GitHub project, built from these issues. The
board is kept up to date by a sync, so almost nothing on it is moved by hand. This page covers what
the sync does, and the few things it can't do.

## How it is structured

| Question                  | Where it lives                                                                     | Why                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| What is the work?         | One **issue** per feature, bug or piece of groundwork                              | Pull requests close them (`Fixes #12`), and the board follows           |
| Which release is it in?   | The issue's **milestone**                                                          | A milestone shows its own % complete, with no delivery date to maintain |
| Which area?               | A **sub-issue** of the area's issue (Media, Groups...), which has the `area` label | The area issue shows a progress bar, and the board can group by parent  |
| What kind of work?        | A **label**: `feature`, `design`, `architecture`, `bug`                            | The issue forms set it, so a report arrives already labelled            |
| Does it need libsession?  | The **`libsession`** label, and a **blocked by** link                              | The workstream issue it is blocked by says what libsession is missing   |
| What has to happen first? | **Blocked by** links between issues                                                | Shown on the issue and on the board as **Waiting on**                   |
| How important is it?      | The board's **Priority** field, then the order within a column                     | The milestone says _when_; priority says what goes first within it      |
| How big is it?            | The board's **Difficulty** field, 1 Trivial to 5 Very high                         |                                                                         |
| Where is it up to?        | The board's **Status** field                                                       | Set by the sync; see below                                              |

There are no dates. A release's progress is its milestone's % complete.

## Releases, Next and the backlog

- **Each planned release is a milestone.**
- **Next** holds fixes made between releases. Closing a release's milestone moves Next's _closed_
  issues onto it, so they ship as part of that release; unfinished ones stay in Next. To ship Next
  on its own instead, rename it to the release, close it, and make a new Next.
- **No milestone means not scheduled.** The issue stays in Backlog, and its Priority says whether it
  should be pulled into Next or a release.

### Ordering releases

The **Releases** view groups by the **Release** field, which mirrors each issue's milestone: a view
grouped by milestone can only be ordered by due date, and milestones have none.

- **To change the order, drag the options** in the project's settings, under the Release field. The
  view, and the weekly progress update, follow that order. This is how a point release goes before
  the next alpha.
- **A new milestone is added at the end**, so it usually needs dragging into place.
- **Rename the milestone, never the option.** The sync follows a renamed milestone and keeps its
  option in the same place; an option renamed by hand is put back.
- **A deleted milestone loses its option.** Its issues go back to no milestone, and so to Backlog.

## Status, and what moves it

| Status      | Means                                                                | Set by                                    |
| ----------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Backlog     | Not scheduled (no milestone), or waiting on something still open     | The sync                                  |
| Ready       | Nothing blocking it, and scheduled in Next or a release              | The sync                                  |
| In progress | Someone has started: a draft pull request, or changes were requested | The sync, or by hand before there is a PR |
| In review   | A pull request is ready for review; review includes testing it       | The sync                                  |
| Approved    | Approved; the author merges                                          | The sync                                  |
| Done        | Merged or closed                                                     | The sync                                  |

- **Only In progress is ever set by hand**, for work started before a pull request exists. The sync
  leaves it there. A card dragged to any other column is moved back on the next run. Area issues,
  which the sync knows by the `area` label, are the exception: their Status is left alone, and only
  they are listed in the weekly update.
- **An issue the sync moved to In progress for a draft pull request goes back** to Ready or Backlog
  if that pull request is closed unmerged or stops saying it fixes the issue. The sync records the
  Status it last set in a hidden **Synced status** field, which is how it tells the two apart.
- **An issue follows the pull request that will close it** (`Fixes #12` in its description, which
  can be added after it is opened).
- **Some changes take up to an hour to show:** blocked-by links, adding or removing the `area`
  label, and transferring an issue fire no event the sync runs on, so its hourly run picks them up.
  Everything else shows within a minute or so.

## Triage

New reports come in through the issue forms with the `triage` label and no milestone, so they sit in
Backlog. Triage gives each one a milestone (Next or a release), leaves it in Backlog with a
priority, or closes it. That is the one step the board can't do for itself.

## Views

- **Releases**: every issue grouped by release in the dragged order, sorted by Priority. Unscheduled
  issues are in the group with no release.
- **Board**: every issue by Status.
- **Areas**: the area issues, each with its progress bar.
- **Up next**: Ready issues at the top priority, for picking up something to do.
- **My reviews**: pull requests waiting on your review. One leaves it when you approve or request
  changes.
- **Planning**: open issues with no milestone, to group by Priority when choosing what goes into the
  next release.

## The sync

`.github/scripts/sync_board.py`, run by `.github/workflows/board.yml`:

- on every issue, pull request, review and milestone event;
- hourly, for blocked-by links;
- Mondays at 09:00 UTC, to post a progress update to the project instead.

Syncs never overlap. Closing a milestone runs only the fold, and the Monday run only posts the
update; each has a run of its own that a later event can't cancel. A sync can be started by hand
from the Actions tab.

Issues and pull requests from other repositories can go on the board too. Each is looked up in its
own repository, but only this repository's issues, and its pull requests while they're open, are
added automatically, and only its issues get a Release. A blocker in a repository the app can't
read is left out of Waiting on, and the run logs a warning.

It writes with a token from the board's GitHub App, set by the `BOARD_APP_ID` and `BOARD_APP_KEY`
secrets, and the `BOARD_PROJECT_NUMBER` variable says which project. Until all three are set, it
skips. The project needs these fields, or the sync stops and names the missing ones:

- **Status**, single select: Backlog, Ready, In progress, In review, Approved, Done;
- **Release**, single select, whose options the sync fills from the milestones;
- **Waiting on**, text;
- **Synced status**, text, hidden from every view;
- **Priority** and **Difficulty**, single select, which the sync doesn't touch.

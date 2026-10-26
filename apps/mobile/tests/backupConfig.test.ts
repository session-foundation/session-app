/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ExpoConfig } from 'expo/config'
import { describe, expect, it } from 'vitest'

import appJson from '../app.json'
import makeConfig from '../app.config'

/** Every place Android keeps an app's files, as its backup rules name them. */
const DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
  'external',
]

type Mod = (config: Record<string, unknown>) => Promise<Record<string, unknown>>

function resolved(): ExpoConfig & { mods?: { android?: Record<string, Mod> } } {
  return makeConfig({
    config: appJson.expo as ExpoConfig,
    projectRoot: '.',
    staticConfigPath: null,
    packageJsonPath: null,
  })
}

/**
 * Nothing the app keeps may leave the phone by backup or by transfer to a new one. Each of these
 * is a line of config that, lost, would quietly let it: there is no failure to notice, only data
 * in an iCloud backup or on the next phone.
 */
describe('the app config keeps everything on the device', () => {
  it('turns Android backup off', () => {
    expect(resolved().android?.allowBackup).toBe(false)
  })

  it('stops expo-secure-store writing backup rules of its own, and applies it only once', () => {
    const plugins = resolved().plugins ?? []
    const secureStore = plugins.filter(
      (plugin) =>
        plugin === 'expo-secure-store' ||
        (Array.isArray(plugin) && plugin[0] === 'expo-secure-store'),
    )
    expect(secureStore).toEqual([['expo-secure-store', { configureAndroidBackup: false }]])
  })

  it('excludes every domain from cloud backup and device transfer', async () => {
    const config = resolved()
    const manifest = {
      manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] },
    }
    const modded = await config.mods?.android?.['manifest']?.({
      ...config,
      modResults: manifest,
      modRequest: { platform: 'android', modName: 'manifest' },
    })
    const results = modded?.['modResults'] as typeof manifest | undefined
    expect(results?.manifest.application[0]?.$).toEqual({
      'android:name': '.MainApplication',
      'android:dataExtractionRules': '@xml/session_data_extraction_rules',
      'android:fullBackupContent': '@xml/session_backup_rules',
    })

    const project = mkdtempSync(join(tmpdir(), 'backup-rules-'))
    try {
      await config.mods?.android?.['dangerous']?.({
        ...config,
        modResults: null,
        modRequest: { platform: 'android', modName: 'dangerous', platformProjectRoot: project },
      })
      const xml = (name: string) =>
        readFileSync(join(project, 'app/src/main/res/xml', name), 'utf8')
      const rules = xml('session_data_extraction_rules.xml')
      for (const section of ['cloud-backup', 'device-transfer']) {
        const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(rules)?.[1] ?? ''
        for (const domain of DOMAINS)
          expect(body).toContain(`<exclude domain="${domain}" path="." />`)
        expect(body).not.toContain('<include')
      }
      const legacy = xml('session_backup_rules.xml')
      for (const domain of DOMAINS)
        expect(legacy).toContain(`<exclude domain="${domain}" path="." />`)
      expect(legacy).not.toContain('<include')
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  it('puts the iOS data in an app group that follows the bundle identifier', () => {
    const ios = resolved().ios
    const group = `group.${ios?.bundleIdentifier ?? ''}`
    expect(ios?.entitlements?.['com.apple.security.application-groups']).toEqual([group])
    expect(ios?.infoPlist?.['SessionAppGroup']).toBe(group)
  })
})

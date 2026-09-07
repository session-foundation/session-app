import { baseConfig, mobileAppZone } from '@session/eslint-config'

export default [
  {
    ignores: [
      '.expo/**',
      'android/**',
      'ios/**',
      'web/**',
      'metro.config.js',
      'babel.config.js',
      'collector.mjs',
    ],
  },
  ...baseConfig({ tsconfigRootDir: import.meta.dirname, zone: mobileAppZone }),
]

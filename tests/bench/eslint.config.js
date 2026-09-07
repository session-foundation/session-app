import { baseConfig, universalZone } from '@session/eslint-config'

export default [
  // The Expo app under mobile/ has its own config: it is React Native rather than universal, and
  // it carries the CommonJS config files every Expo project does.
  { ignores: ['mobile/**'] },
  ...baseConfig({ tsconfigRootDir: import.meta.dirname, zone: universalZone }),
]

import { baseConfig, universalZone } from '@session/eslint-config'

export default [...baseConfig({ tsconfigRootDir: import.meta.dirname, zone: universalZone })]

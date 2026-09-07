const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

/**
 * Metro has to be told about the workspace root, because the packages this measures live
 * outside this directory and Metro does not walk upwards on its own. The repo uses pnpm's
 * hoisted linker for exactly this reason - see .npmrc.
 */
const workspaceRoot = path.resolve(__dirname, '../../..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

/**
 * The bench never opens a bridge, but importing the client's barrel reaches one: Metro picks the
 * `.native` transport, which needs a Nitro module Expo Go cannot have. Resolving it to a stub is
 * what lets the JavaScript half be measured without a dev client.
 */
const stub = path.resolve(__dirname, 'src/nitro-stub.ts')
const defaultResolve = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@session/bridge-rn' || moduleName === 'react-native-nitro-modules') {
    return { type: 'sourceFile', filePath: stub }
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config

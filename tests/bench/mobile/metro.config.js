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

module.exports = config

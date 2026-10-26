/**
 * react-native-svg's Android touch sound, which the web never plays. The real module asks React
 * Native's TurboModule registry for a native module, and react-native-web has no registry: see
 * `svgSoundModuleShim` in electron.vite.config.ts.
 */
export default {
  playTouchSound(): void {},
}

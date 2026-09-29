/** A file's text, as Vite's `?raw` suffix imports it. Only tests read one. */
declare module '*?raw' {
  const text: string
  export default text
}

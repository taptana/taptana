/** build.mjs mete los .css en el bundle como texto ya minificado. */
declare module '*.css' {
  const css: string;
  export default css;
}

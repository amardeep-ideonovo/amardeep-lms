// mjml@5 ships no TypeScript types. Minimal ambient declaration for the one
// shape we use: the default export compiles an MJML string to HTML and returns
// the html plus any parse/validation errors. (mjml-core exposes far more
// options; we only need the convert + errors surface.)
declare module 'mjml' {
  interface MjmlError {
    line?: number;
    message: string;
    tagName?: string;
    formattedMessage?: string;
  }
  interface Mjml2HtmlResult {
    html: string;
    errors: MjmlError[];
  }
  interface Mjml2HtmlOptions {
    validationLevel?: 'strict' | 'soft' | 'skip';
    minify?: boolean;
    keepComments?: boolean;
    beautify?: boolean;
    [key: string]: unknown;
  }
  function mjml2html(
    mjml: string,
    options?: Mjml2HtmlOptions,
  ): Mjml2HtmlResult;
  export default mjml2html;
}

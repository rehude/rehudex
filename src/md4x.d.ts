declare module "md4x" {
  export interface AnsiOptions {
    heal?: boolean;
    showUrls?: boolean;
    showFrontmatter?: boolean;
  }
  export function renderToAnsi(input: string, opts?: AnsiOptions): string;
  export function heal(input: string): string;
}

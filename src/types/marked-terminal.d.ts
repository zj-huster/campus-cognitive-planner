declare module "marked-terminal" {
  import { Renderer } from "marked"
  
  export interface TerminalRendererOptions {
    code?: any
    codespan?: any
    strong?: any
    em?: any
    del?: any
    link?: any
    heading?: any
    tableBorder?: any
    listitem?: any
    blockquote?: any
    hr?: any
    [key: string]: any
  }
  
  export function markedTerminal(
    options?: TerminalRendererOptions,
    highlightOptions?: any
  ): any
  
  export default class TerminalRenderer extends Renderer {
    constructor(options?: TerminalRendererOptions, highlightOptions?: any)
  }
}

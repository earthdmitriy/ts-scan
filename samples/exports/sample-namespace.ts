// Namespace import sample
export namespace MyNamespace {
  export const version: string = "1.0.0";
  export function helper(): void {}
  export interface INested {
    id: number;
  }
}

export { MyNamespace as AliasedNamespace };

type Stripper = {
  stripImport: (importPath: string) => string;
  getImports: () => string[];
};

export type StripImportFn = Stripper["stripImport"];

export const createStripper = (): Stripper => {
  const imports = new Set<string>();

  // 'import("D:/Win/Projects/ts-scan/samples/exports/sample-dependencies").ComplexType'
  // => ComplexType

  const stripImport = (type: string): string => {
    let prev = type;
    let curr = type.replace(/import\("([^"]+)"\)\.(\w+)/g, (_, path, id) => {
      imports.add(path);
      return id;
    });
    while (curr !== prev) {
      prev = curr;
      curr = curr.replace(/import\("([^"]+)"\)\.(\w+)/g, (_, path, id) => {
        imports.add(path);
        return id;
      });
    }
    return curr;
  };

  return {
    stripImport,
    getImports: () => [...imports.keys()],
  };
};

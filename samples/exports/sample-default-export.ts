// Default export sample
export default class DefaultExportClass {
  constructor(public name: string) {}
  
  greet(): string {
    return `Hello, ${this.name}!`;
  }
}

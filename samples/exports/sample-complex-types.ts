import { Component } from "@angular/core";
import { Project } from "ts-morph";

/**
 * Chaos component for testing.
 */
@Component({
  selector: "app-chaos",
  templateUrl: "./chaos.component.html",
})
export class ChaosComponent {
  project: Project = new Project();
}

// Additional exports for re-export testing
export interface ComplexInterface {
  id: number;
  name: string;
}

export class ComplexModule {
  constructor(public project: Project) {}
  
  getValue(): string {
    return "test";
  }
}

export type ComplexType = "a" | "b" | "c";

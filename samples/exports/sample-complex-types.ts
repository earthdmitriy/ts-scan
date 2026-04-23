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
  project = new Project();
}

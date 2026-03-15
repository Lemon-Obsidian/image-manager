import { Plugin } from "obsidian";

export default class ImageManagerPlugin extends Plugin {
  async onload() {
    console.log("ImageManager plugin loaded");
  }

  onunload() {
    console.log("ImageManager plugin unloaded");
  }
}

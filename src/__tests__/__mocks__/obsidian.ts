// Obsidian API 최소 mock — 테스트에서 import되는 심볼만 선언
export class Notice {
  constructor(_msg: string, _timeout?: number) {}
  setMessage(_msg: string) {}
  hide() {}
}

export class Modal {
  contentEl = { empty: () => {}, createEl: () => ({}) };
  constructor(_app: unknown) {}
  open() {}
  close() {}
}

export class Plugin {}
export class PluginSettingTab {
  containerEl = { empty: () => {}, createEl: () => ({}) };
  constructor(_app: unknown, _plugin: unknown) {}
}
export class Setting {
  constructor(_container: unknown) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addToggle(_fn: unknown) { return this; }
  addDropdown(_fn: unknown) { return this; }
  addText(_fn: unknown) { return this; }
  addTextArea(_fn: unknown) { return this; }
  addSlider(_fn: unknown) { return this; }
}
export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = '';
  stat = { size: 0, mtime: 0, ctime: 0 };
  parent = null;
}

export const requestUrl = async (_opts: unknown) => ({ arrayBuffer: new ArrayBuffer(0), json: {}, status: 200 });

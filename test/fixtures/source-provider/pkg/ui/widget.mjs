const register = Library();
let name = "";

class Widget extends Base {
  constructor() {
    super();
    this.mode = "full";
  render(mode = this.mode) {
    let out = "";
    if (mode === "full") {
      out += this.name;
      out += ":";
      out += this.size;
    } else if (mode === "brief") {
      out += this.name;
    } else {
      throw new ValueError("unknown mode: " + mode);
    }
    return out;
  }
  }

  get size() {
    return this._size || 0;
  }

  set size(v) {
    this._size = v;
  }

  toString() {
    return this.render("brief");
  }

  describe() {
    return `Widget(${this.name})`;
  }
}

export { Widget, register };

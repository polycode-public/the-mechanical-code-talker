// A base class the widget layer extends — the inheritance root of this fixture.
export class Base {
  constructor(name) {
    this.name = name;
  }

  describe() {
    return `base:${this.name}`;
  }
}

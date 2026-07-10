class Button extends Widget {
  constructor() {
    super();
    this.pressed = false;
  }

  press() {
    this.pressed = true;
  }

  release() { this.pressed = false; }
}

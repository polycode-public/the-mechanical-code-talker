package com.acme.shapes;

/** Something that can be drawn onto a canvas. */
public interface Drawable {
    void draw();

    /** Default one-line label. */
    default String label() {
        return "drawable";
    }
}

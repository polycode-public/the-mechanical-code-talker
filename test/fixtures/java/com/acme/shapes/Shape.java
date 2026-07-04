// Hand-written Java fixture for the bake-off (synthetic; NOT third-party code).
package com.acme.shapes;

/** A geometric shape with a name and an area. */
public abstract class Shape {
    protected final String name;

    public Shape(String name) {
        this.name = name;
    }

    public abstract double area();

    /** Human-readable one-line description. */
    public String describe() {
        return name + " area=" + area();
    }
}

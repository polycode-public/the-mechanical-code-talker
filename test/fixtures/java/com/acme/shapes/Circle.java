package com.acme.shapes;

public class Circle extends Shape implements Drawable {
    private final double radius;

    public Circle(double radius) {
        super("circle");
        this.radius = radius;
    }

    @Override
    public double area() {
        return Math.PI * radius * radius;
    }

    @Override
    public void draw() {
        describe();
    }
}

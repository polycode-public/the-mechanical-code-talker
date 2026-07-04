package com.acme.shapes;

public record Point(double x, double y) {
    public double distanceTo(Point other) {
        double dx = x - other.x();
        double dy = y - other.y();
        return Math.sqrt(dx * dx + dy * dy);
    }
}

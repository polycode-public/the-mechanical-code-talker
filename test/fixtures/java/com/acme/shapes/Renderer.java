package com.acme.shapes;

import java.util.List;

public class Renderer {

    /** A single rendered frame. */
    public static class Frame {
        public final String content;

        public Frame(String content) {
            this.content = content;
        }
    }

    public String render(List<Shape> shapes) {
        StringBuilder sb = new StringBuilder();
        for (Shape s : shapes) {
            sb.append(s.describe());
        }
        return sb.toString();
    }

    public Frame snapshot(List<Shape> shapes) {
        return new Frame(render(shapes));
    }
}

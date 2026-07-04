from pkg.alpha import alpha_helper, Base


class Widget(Base):
    name = "w"

    def render(self):
        return alpha_helper()

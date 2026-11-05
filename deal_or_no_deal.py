#!/usr/bin/env python3
"""Deal or No Deal: a desktop game using only the Python standard library.

Run with:  python deal_or_no_deal.py
Keys:      D = deal, N = no deal, K = keep, S = swap, R = play again,
           6 or 7 = turn the 6 7 spam on or off
"""

from __future__ import annotations

import random
import sys
import tkinter as tk

CASE_VALUES = (
    0.01, 1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750,
    1_000, 5_000, 10_000, 25_000, 50_000, 75_000, 100_000,
    200_000, 300_000, 400_000, 500_000, 750_000, 1_000_000,
)
ROUND_SCHEDULE = (6, 5, 4, 3, 2, 1, 1, 1, 1)
# The banker starts stingy and approaches a fair offer as the game goes on.
BANKER_FACTORS = (0.15, 0.24, 0.33, 0.43, 0.53, 0.64, 0.75, 0.86, 0.97)
BANKER_JITTER = 0.04


def format_money(value: float) -> str:
    if value == int(value):
        return f"${int(value):,}"
    return f"${value:,.2f}"


def round_offer(value: float) -> float:
    """Round to the kind of tidy number a banker would actually say."""
    if value < 1:
        return max(round(value, 2), 0.01)
    if value < 100:
        step = 1
    elif value < 1_000:
        step = 5
    elif value < 10_000:
        step = 50
    elif value < 100_000:
        step = 100
    else:
        step = 1_000
    return float(round(value / step) * step)


class Game:
    """The rules of the game, with no UI code."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        values = list(CASE_VALUES)
        self.rng.shuffle(values)
        self.cases = {number: value for number, value in enumerate(values, 1)}
        self.phase = "pick"  # pick -> open <-> offer -> final -> over
        self.player_case: int | None = None
        self.opened: list[int] = []
        self.round_index = 0
        self.opened_this_round = 0
        self.offers: list[float] = []
        self.winnings: float | None = None
        self.outcome: str | None = None  # "deal", "keep" or "swap"

    @property
    def unopened(self) -> list[int]:
        return [n for n in self.cases if n not in self.opened]

    @property
    def remaining_values(self) -> list[float]:
        return sorted(self.cases[n] for n in self.unopened)

    @property
    def to_open(self) -> int:
        return ROUND_SCHEDULE[self.round_index] - self.opened_this_round

    @property
    def round_number(self) -> int:
        return self.round_index + 1

    @property
    def current_offer(self) -> float:
        return self.offers[-1]

    @property
    def other_case(self) -> int:
        """The one other sealed case left in the final decision."""
        others = [n for n in self.unopened if n != self.player_case]
        if len(others) != 1:
            raise ValueError("There is more than one other case left")
        return others[0]

    def _require(self, phase: str) -> None:
        if self.phase != phase:
            raise ValueError(f"Cannot do that during the {self.phase} phase")

    def pick(self, number: int) -> None:
        self._require("pick")
        if number not in self.cases:
            raise ValueError(f"No such case: {number}")
        self.player_case = number
        self.phase = "open"

    def open_case(self, number: int) -> float:
        self._require("open")
        if number not in self.cases or number in self.opened:
            raise ValueError(f"Case {number} cannot be opened")
        if number == self.player_case:
            raise ValueError("You cannot open your own case")
        self.opened.append(number)
        self.opened_this_round += 1
        if self.to_open == 0:
            self.offers.append(self._banker_offer())
            self.phase = "offer"
        return self.cases[number]

    def _banker_offer(self) -> float:
        values = self.remaining_values
        average = sum(values) / len(values)
        factor = BANKER_FACTORS[self.round_index]
        factor += self.rng.uniform(-BANKER_JITTER, BANKER_JITTER)
        return min(round_offer(average * factor), max(values))

    def deal(self) -> None:
        self._require("offer")
        self.winnings = self.current_offer
        self.outcome = "deal"
        self.phase = "over"

    def no_deal(self) -> None:
        self._require("offer")
        if self.round_index == len(ROUND_SCHEDULE) - 1:
            self.phase = "final"
            return
        self.round_index += 1
        self.opened_this_round = 0
        self.phase = "open"

    def keep(self) -> None:
        self._require("final")
        self.winnings = self.cases[self.player_case]
        self.outcome = "keep"
        self.phase = "over"

    def swap(self) -> None:
        self._require("final")
        self.winnings = self.cases[self.other_case]
        self.outcome = "swap"
        self.phase = "over"

    def verdict(self) -> str:
        self._require("over")
        own = self.cases[self.player_case]
        if self.outcome == "deal":
            if self.winnings >= own:
                return (f"You took the deal, and case {self.player_case} held "
                        f"only {format_money(own)}. You beat the banker!")
            return (f"You took the deal, but case {self.player_case} held "
                    f"{format_money(own)}. The banker got you this time.")
        other = self.cases[self.other_case]
        left_behind = other if self.outcome == "keep" else own
        action = "kept your case" if self.outcome == "keep" else "swapped cases"
        result = "You beat" if self.winnings >= self.current_offer else "You fell short of"
        return (f"You {action}, and the other one held {format_money(left_behind)}. "
                f"{result} the banker's last offer of {format_money(self.current_offer)}.")


# ---------------------------------------------------------------------------
# User interface. Everything is drawn on one canvas in a 1280x800 virtual
# space, which is scaled to fit, so the layout holds at any window size.
# ---------------------------------------------------------------------------

WIDTH, HEIGHT = 1280, 800
FONT = "Segoe UI"
BG = "#0a0f1f"
PANEL = "#141b33"
PANEL_EDGE = "#2b3760"
TEXT = "#f2f4fb"
MUTED = "#98a3c7"
GOLD = "#f0c040"
CASE_BODY = "#c9a227"
CASE_HOVER = "#ecc544"
CASE_EDGE = "#7f6410"
LOW_PLATE = "#1f5fbf"
HIGH_PLATE = "#e0b03c"
DEAD_PLATE = "#141a2e"
DEAD_TEXT = "#3f4868"
GREEN = "#1f9d55"
GREEN_HOVER = "#27bd67"
RED = "#c8323c"
RED_HOVER = "#e4454f"
BLUE = "#2a6fd6"
BLUE_HOVER = "#3f85ee"
GREY = "#3a4466"
GREY_HOVER = "#4e5a85"
DIM_AMOUNT = 0.28
GRID_ROWS = (6, 7, 7, 6)
REVEAL_MS = 1200
CALLING_MS = 1300
SPAM_MS = 70
SPAM_PER_TICK = 4
SPAM_MAX = 140
SPAM_COLORS = ("#ff3b6b", "#ffd60a", "#2ee6a6", "#3fa9ff", "#c77dff", "#ff8c1a", "#ffffff")
SPAM_KEYS = {"6", "7", "kp_6", "kp_7"}


class App:
    def __init__(self, root: tk.Tk, rng: random.Random | None = None) -> None:
        self.root = root
        self.rng = rng
        self.canvas = tk.Canvas(root, bg=BG, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.regions: list[tuple[float, float, float, float, str, object]] = []
        self.hover: str | None = None
        self.overlay: dict | None = None
        self.timer: str | None = None
        self.spam: list[tuple[float, float, int, str, int]] = []
        self.spam_ids: list[int] = []
        self.spam_timer: str | None = None
        self.scale = 1.0
        self.dimmed = False
        self.ox = self.oy = 0.0
        self.canvas.bind("<Configure>", lambda _e: self.draw())
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Button-1>", self.on_click)
        root.bind("<Key>", self.on_key)
        self.new_game()

    # ----- game flow -----

    def new_game(self) -> None:
        self._cancel_timer()
        self.game = Game(self.rng)
        self.overlay = None
        self.hover = None
        self.draw()

    def _cancel_timer(self) -> None:
        if self.timer is not None:
            self.root.after_cancel(self.timer)
            self.timer = None

    def click_case(self, number: int) -> None:
        if self.game.phase == "pick":
            self.game.pick(number)
        else:
            value = self.game.open_case(number)
            self.overlay = {"type": "reveal", "number": number, "value": value}
            self.timer = self.root.after(REVEAL_MS, self.end_reveal)
        self.hover = None
        self.draw()

    def end_reveal(self) -> None:
        self._cancel_timer()
        if self.game.phase == "offer":
            self.overlay = {"type": "calling"}
            self.timer = self.root.after(CALLING_MS, self.end_calling)
        else:
            self.overlay = None
        self.draw()

    def end_calling(self) -> None:
        self._cancel_timer()
        self.overlay = None
        self.draw()

    def act(self, action) -> None:
        action()
        self.hover = None
        self.draw()

    # ----- 6 7 spam -----

    def toggle_spam(self) -> None:
        if self.spam_timer is None:
            self.spam_tick()
        else:
            self.root.after_cancel(self.spam_timer)
            self.spam_timer = None
            self.spam = []
        self.draw()

    def spam_tick(self) -> None:
        # Only add and remove the changed items. Redrawing the whole screen
        # this often would make the game lag.
        for _ in range(SPAM_PER_TICK):
            item = (random.uniform(0, WIDTH), random.uniform(0, HEIGHT),
                    random.randint(28, 96), random.choice(SPAM_COLORS),
                    random.randint(-25, 25))
            self.spam.append(item)
            self.spam_ids.append(self.draw_spam_item(item))
        extra = len(self.spam) - SPAM_MAX
        if extra > 0:
            self.canvas.delete(*self.spam_ids[:extra])
            del self.spam[:extra], self.spam_ids[:extra]
        self.canvas.tag_raise("spam_button")
        self.spam_timer = self.root.after(SPAM_MS, self.spam_tick)

    def draw_spam_item(self, item: tuple) -> int:
        x, y, size, color, angle = item
        return self.canvas.create_text(self.px(x), self.py(y), text="6 7", fill=color, angle=angle,
                                       font=self.font(size, "bold"))

    def draw_spam(self) -> None:
        self.spam_ids = [self.draw_spam_item(item) for item in self.spam]
        spamming = self.spam_timer is not None
        self.button("spam", 1150, 18, 1256, 74, "STOP" if spamming else "6 7",
                    RED if spamming else BLUE, RED_HOVER if spamming else BLUE_HOVER,
                    self.toggle_spam, 24)
        for item in self.canvas.find_all()[-2:]:  # The button's shape and label.
            self.canvas.addtag_withtag("spam_button", item)

    # ----- input -----

    def _region_at(self, x: float, y: float):
        for region in reversed(self.regions):
            if region[0] <= x <= region[2] and region[1] <= y <= region[3]:
                return region
        return None

    def on_motion(self, event: tk.Event) -> None:
        region = self._region_at(event.x, event.y)
        hover = region[4] if region else None
        if hover != self.hover:
            self.hover = hover
            self.draw()

    def on_click(self, event: tk.Event) -> None:
        region = self._region_at(event.x, event.y)
        if region and region[4] == "spam":
            region[5]()
        elif self.overlay and self.overlay["type"] == "reveal":
            self.end_reveal()  # A click skips the reveal pause.
        elif region:
            region[5]()

    def on_key(self, event: tk.Event) -> None:
        key = (event.keysym or "").lower()
        if key in SPAM_KEYS:
            self.toggle_spam()
            return
        if self.overlay:
            return
        game = self.game
        actions = {
            "offer": {"d": game.deal, "n": game.no_deal},
            "final": {"k": game.keep, "s": game.swap},
        }.get(game.phase, {})
        if key in actions:
            self.act(actions[key])
        elif key == "r" and game.phase == "over":
            self.new_game()

    # ----- drawing helpers -----

    def px(self, x: float) -> float:
        return self.ox + x * self.scale

    def py(self, y: float) -> float:
        return self.oy + y * self.scale

    def font(self, size: float, weight: str = "normal") -> tuple:
        return (FONT, -max(int(size * self.scale), 6), weight)

    def shade(self, color: str) -> str:
        """Fade a color toward the background while a dialog is open."""
        if not self.dimmed or not color:
            return color
        channels = (int(color[i:i + 2], 16) for i in (1, 3, 5))
        base = (int(BG[i:i + 2], 16) for i in (1, 3, 5))
        mixed = (round(b + (c - b) * DIM_AMOUNT) for c, b in zip(channels, base))
        return "#{:02x}{:02x}{:02x}".format(*mixed)

    def rrect(self, x0, y0, x1, y1, r=10, **kw) -> None:
        for option in ("fill", "outline"):
            if option in kw:
                kw[option] = self.shade(kw[option])
        x0, y0, x1, y1 = self.px(x0), self.py(y0), self.px(x1), self.py(y1)
        r *= self.scale
        points = [
            x0 + r, y0, x0 + r, y0, x1 - r, y0, x1 - r, y0, x1, y0, x1, y0 + r,
            x1, y0 + r, x1, y1 - r, x1, y1 - r, x1, y1, x1 - r, y1, x1 - r, y1,
            x0 + r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y1 - r, x0, y0 + r,
            x0, y0 + r, x0, y0,
        ]
        self.canvas.create_polygon(points, smooth=True, **kw)

    def text(self, x, y, text, size=18, color=TEXT, weight="normal", anchor="center", wrap=None) -> None:
        options = {"width": wrap * self.scale, "justify": "center"} if wrap else {}
        self.canvas.create_text(self.px(x), self.py(y), text=text, fill=self.shade(color), anchor=anchor,
                                font=self.font(size, weight), **options)

    def add_region(self, x0, y0, x1, y1, region_id: str, callback) -> None:
        self.regions.append((self.px(x0), self.py(y0), self.px(x1), self.py(y1), region_id, callback))

    def button(self, region_id, x0, y0, x1, y1, label, fill, hover_fill, callback, size=24) -> None:
        self.rrect(x0, y0, x1, y1, 12, fill=hover_fill if self.hover == region_id else fill, outline="")
        self.text((x0 + x1) / 2, (y0 + y1) / 2, label, size, "#ffffff", "bold")
        self.add_region(x0, y0, x1, y1, region_id, callback)

    def draw_case(self, x, y, w, h, label, hover=False, highlight=False) -> None:
        if hover:
            y -= 4
        body_top = y + h * 0.16
        handle_w = w * 0.3
        self.rrect(x + w / 2 - handle_w / 2, y, x + w / 2 + handle_w / 2, body_top + 6, 5,
                   fill="", outline=CASE_EDGE, width=max(2, 3 * self.scale))
        self.rrect(x, body_top, x + w, y + h, 8, fill=CASE_HOVER if hover else CASE_BODY,
                   outline="#ffffff" if highlight else CASE_EDGE,
                   width=max(1, (3 if highlight else 2) * self.scale))
        plate_w, plate_h = w * 0.56, (y + h - body_top) * 0.62
        cx, cy = x + w / 2, (body_top + y + h) / 2
        self.rrect(cx - plate_w / 2, cy - plate_h / 2, cx + plate_w / 2, cy + plate_h / 2, 5,
                   fill="#fff8e1", outline=CASE_EDGE)
        self.text(cx, cy, label, h * 0.31, "#1b1b1b", "bold")

    # ----- drawing the screen -----

    def draw(self) -> None:
        canvas = self.canvas
        width, height = canvas.winfo_width(), canvas.winfo_height()
        if width < 2 or height < 2:
            return
        self.scale = min(width / WIDTH, height / HEIGHT)
        self.ox = (width - WIDTH * self.scale) / 2
        self.oy = (height - HEIGHT * self.scale) / 2
        canvas.delete("all")
        self.regions = []

        revealing = self.overlay and self.overlay["type"] == "reveal"
        self.dimmed = not revealing and (bool(self.overlay) or self.game.phase in ("offer", "final", "over"))
        self.draw_header()
        self.draw_ladders()
        self.draw_grid()
        self.draw_footer()
        self.dimmed = False
        self.draw_dialog()
        self.draw_spam()

        ids = {region[4] for region in self.regions}
        canvas.config(cursor="hand2" if self.hover in ids else "")

    def status_text(self) -> str:
        game = self.game
        if game.phase == "pick":
            return "Choose your case. It stays sealed until the end."
        if game.phase == "open":
            noun = "case" if game.to_open == 1 else "cases"
            return f"Round {game.round_number}: open {game.to_open} more {noun}."
        if game.phase == "offer":
            return f"Round {game.round_number} is done. Time to hear from the banker."
        if game.phase == "final":
            return "Two cases left. One last decision."
        return "Game over."

    def draw_header(self) -> None:
        self.text(WIDTH / 2, 38, "DEAL OR NO DEAL", 42, GOLD, "bold")
        self.text(WIDTH / 2, 80, self.status_text(), 20, TEXT)

    def draw_ladders(self) -> None:
        values = sorted(CASE_VALUES)
        alive = set(self.game.remaining_values)
        for column, x0 in enumerate((24, 1056)):
            for row, value in enumerate(values[column * 13:(column + 1) * 13]):
                y0 = 110 + row * 52
                live = value in alive
                plate = (HIGH_PLATE if column else LOW_PLATE) if live else DEAD_PLATE
                color = ("#20180a" if column else "#ffffff") if live else DEAD_TEXT
                self.rrect(x0, y0, x0 + 200, y0 + 45, 8, fill=plate, outline="" if live else PANEL_EDGE)
                self.text(x0 + 100, y0 + 22, format_money(value), 22, color, "bold")

    def grid_positions(self):
        case_w, case_h, gap_x, gap_y = 96, 80, 14, 14
        number = 1
        for row, count in enumerate(GRID_ROWS):
            row_width = count * case_w + (count - 1) * gap_x
            start = WIDTH / 2 - row_width / 2
            for col in range(count):
                yield number, start + col * (case_w + gap_x), 110 + row * (case_h + gap_y), case_w, case_h
                number += 1

    def draw_grid(self) -> None:
        game = self.game
        clickable = not self.overlay and game.phase in ("pick", "open")
        for number, x, y, w, h in self.grid_positions():
            if number in game.opened:
                self.rrect(x, y + 12, x + w, y + h, 8, fill=DEAD_PLATE, outline=PANEL_EDGE)
                self.text(x + w / 2, y + 12 + (h - 12) / 2, format_money(game.cases[number]), 15, MUTED, "bold")
            elif number == game.player_case:
                self.rrect(x, y + 12, x + w, y + h, 8, fill="", outline=GOLD, dash=(4, 3))
                self.text(x + w / 2, y + 12 + (h - 12) / 2, "YOURS", 15, GOLD, "bold")
            else:
                region_id = f"case{number}"
                final_other = game.phase == "final"
                self.draw_case(x, y, w, h, str(number), self.hover == region_id, final_other)
                if clickable:
                    self.add_region(x, y, x + w, y + h, region_id,
                                    lambda n=number: self.click_case(n))

    def draw_footer(self) -> None:
        game = self.game
        self.rrect(244, 500, 1036, 776, 14, fill=PANEL, outline=PANEL_EDGE)

        self.text(350, 526, "YOUR CASE", 17, MUTED, "bold")
        if game.player_case is None:
            self.rrect(280, 556, 420, 716, 10, fill="", outline=PANEL_EDGE, dash=(4, 3))
            self.text(350, 636, "Not chosen yet", 18, MUTED, wrap=110)
        else:
            self.draw_case(270, 552, 160, 170, str(game.player_case))
            if game.phase == "over":
                self.text(350, 748, format_money(game.cases[game.player_case]), 22, GOLD, "bold")

        values = game.remaining_values
        stats = [("CASES LEFT", str(len(values))), ("HIGHEST LEFT", format_money(values[-1])),
                 ("AVERAGE LEFT", format_money(round(sum(values) / len(values))))]
        for index, (label, value) in enumerate(stats):
            y = 530 + index * 80
            self.text(600, y, label, 16, MUTED, "bold")
            self.text(600, y + 32, value, 28, TEXT, "bold")

        self.text(885, 526, "BANKER'S OFFERS", 17, MUTED, "bold")
        if not game.offers:
            self.text(885, 636, "No offers yet", 18, MUTED)
        for index, offer in enumerate(game.offers):
            y = 556 + index * 23
            latest = index == len(game.offers) - 1
            self.text(790, y, f"Round {index + 1}", 16, TEXT if latest else MUTED, anchor="w")
            self.text(985, y, format_money(offer), 17, GOLD if latest else MUTED, "bold", anchor="e")

    def dialog_box(self, x0, y0, x1, y1) -> None:
        self.rrect(x0, y0, x1, y1, 20, fill=PANEL, outline=GOLD, width=max(2, 3 * self.scale))

    def draw_dialog(self) -> None:
        game = self.game
        if self.overlay and self.overlay["type"] == "reveal":
            self.draw_reveal()
        elif self.overlay and self.overlay["type"] == "calling":
            self.dialog_box(380, 300, 900, 480)
            self.text(640, 370, "The banker is calling...", 34, TEXT, "bold")
            self.text(640, 420, "Let's hear the offer.", 20, MUTED)
        elif game.phase == "offer":
            self.draw_offer()
        elif game.phase == "final":
            self.draw_final()
        elif game.phase == "over":
            self.draw_over()

    def draw_reveal(self) -> None:
        value = self.overlay["value"]
        if value >= 100_000:
            color, comment = RED_HOVER, "Ouch! That's a big one gone."
        elif value <= 1_000:
            color, comment = GOLD, "Great pick! A small one off the board."
        else:
            color, comment = TEXT, "Not bad. The big money is still out there."
        self.dialog_box(360, 190, 920, 430)
        self.text(640, 235, f"CASE {self.overlay['number']} HELD", 24, MUTED, "bold")
        self.text(640, 310, format_money(value), 66, color, "bold")
        self.text(640, 385, comment, 21, TEXT)

    def draw_offer(self) -> None:
        game = self.game
        self.dialog_box(330, 190, 950, 610)
        self.text(640, 240, f"ROUND {game.round_number}: THE BANKER OFFERS", 24, MUTED, "bold")
        self.text(640, 325, format_money(game.current_offer), 72, "#4fe08a", "bold")
        if game.round_index == len(ROUND_SCHEDULE) - 1:
            next_step = "This is the last offer. After this you keep or swap."
        else:
            next_count = ROUND_SCHEDULE[game.round_index + 1]
            noun = "case" if next_count == 1 else "cases"
            next_step = f"Say no and you open {next_count} more {noun}."
        self.text(640, 415, next_step, 20, TEXT)
        self.button("deal", 370, 460, 630, 550, "DEAL", GREEN, GREEN_HOVER, lambda: self.act(game.deal), 34)
        self.button("no_deal", 650, 460, 910, 550, "NO DEAL", RED, RED_HOVER, lambda: self.act(game.no_deal), 34)
        self.text(640, 578, "Press D for deal or N for no deal", 16, MUTED)

    def draw_final(self) -> None:
        game = self.game
        low, high = game.remaining_values
        self.dialog_box(330, 190, 950, 610)
        self.text(640, 240, "FINAL DECISION", 24, MUTED, "bold")
        self.text(640, 305, f"{format_money(low)}  or  {format_money(high)}", 44, GOLD, "bold")
        self.text(640, 385, f"One is in your case {game.player_case}. The other is in case {game.other_case}.",
                  21, TEXT, wrap=560)
        self.button("keep", 370, 450, 630, 540, f"KEEP CASE {game.player_case}", BLUE, BLUE_HOVER,
                    lambda: self.act(game.keep), 26)
        self.button("swap", 650, 450, 910, 540, f"SWAP FOR {game.other_case}", GREY, GREY_HOVER,
                    lambda: self.act(game.swap), 26)
        self.text(640, 572, "Press K to keep or S to swap", 16, MUTED)

    def draw_over(self) -> None:
        game = self.game
        self.dialog_box(330, 170, 950, 630)
        self.text(640, 220, "YOU WIN", 26, MUTED, "bold")
        self.text(640, 305, format_money(game.winnings), 76, GOLD, "bold")
        self.text(640, 420, game.verdict(), 21, TEXT, wrap=560)
        self.button("again", 370, 500, 630, 590, "PLAY AGAIN", GREEN, GREEN_HOVER, self.new_game, 28)
        self.button("quit", 650, 500, 910, 590, "QUIT", GREY, GREY_HOVER, self.root.destroy, 28)


def enable_sharp_text() -> None:
    """Stop Windows from blurring the window on scaled displays."""
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            pass


def main() -> None:
    enable_sharp_text()
    root = tk.Tk()
    root.title("Deal or No Deal")
    root.configure(bg=BG)
    width = min(WIDTH, int(root.winfo_screenwidth() * 0.92))
    height = min(HEIGHT, int(root.winfo_screenheight() * 0.86))
    left = (root.winfo_screenwidth() - width) // 2
    top = max((root.winfo_screenheight() - height) // 2 - 30, 0)
    root.geometry(f"{width}x{height}+{left}+{top}")
    root.minsize(800, 500)
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()

import random
import unittest

from deal_or_no_deal import CASE_VALUES, ROUND_SCHEDULE, Game, format_money, round_offer


def play_to_final(seed=1):
    game = Game(random.Random(seed))
    game.pick(1)
    for _ in ROUND_SCHEDULE:
        for _ in range(game.to_open):
            number = next(n for n in game.unopened if n != game.player_case)
            game.open_case(number)
        game.no_deal()
    return game


class SetupTests(unittest.TestCase):
    def test_every_value_is_in_exactly_one_case(self):
        game = Game(random.Random(1))
        self.assertEqual(len(game.cases), 26)
        self.assertEqual(sorted(game.cases.values()), sorted(CASE_VALUES))

    def test_schedule_leaves_two_cases(self):
        self.assertEqual(sum(ROUND_SCHEDULE), 24)


class RuleTests(unittest.TestCase):
    def test_cannot_open_before_picking(self):
        with self.assertRaises(ValueError):
            Game().open_case(1)

    def test_cannot_open_own_or_already_opened_case(self):
        game = Game()
        game.pick(5)
        with self.assertRaises(ValueError):
            game.open_case(5)
        game.open_case(6)
        with self.assertRaises(ValueError):
            game.open_case(6)

    def test_offer_arrives_only_when_round_is_finished(self):
        game = Game(random.Random(2))
        game.pick(1)
        for number in range(2, 7):
            game.open_case(number)
            self.assertEqual(game.phase, "open")
        game.open_case(7)
        self.assertEqual(game.phase, "offer")
        self.assertEqual(len(game.offers), 1)

    def test_no_deal_starts_the_next_round(self):
        game = Game(random.Random(2))
        game.pick(1)
        for number in range(2, 8):
            game.open_case(number)
        game.no_deal()
        self.assertEqual((game.phase, game.round_number, game.to_open), ("open", 2, 5))

    def test_deal_pays_the_offer(self):
        game = Game(random.Random(3))
        game.pick(1)
        for number in range(2, 8):
            game.open_case(number)
        offer = game.current_offer
        game.deal()
        self.assertEqual((game.phase, game.winnings), ("over", offer))
        self.assertIn("deal", game.verdict())

    def test_keep_and_swap_pay_the_right_case(self):
        game = play_to_final()
        self.assertEqual(game.phase, "final")
        self.assertEqual(len(game.unopened), 2)
        game.keep()
        self.assertEqual(game.winnings, game.cases[game.player_case])
        self.assertIn("kept", game.verdict())

        game = play_to_final()
        game.swap()
        self.assertEqual(game.winnings, game.cases[game.other_case])
        self.assertIn("swapped", game.verdict())

    def test_offers_never_exceed_the_top_value_left(self):
        for seed in range(300):
            game = Game(random.Random(seed))
            game.pick(1)
            for _ in ROUND_SCHEDULE:
                for _ in range(game.to_open):
                    number = game.rng.choice([n for n in game.unopened if n != game.player_case])
                    game.open_case(number)
                self.assertGreater(game.current_offer, 0)
                self.assertLessEqual(game.current_offer, max(game.remaining_values))
                game.no_deal()


class FormatTests(unittest.TestCase):
    def test_format_money(self):
        self.assertEqual(format_money(0.01), "$0.01")
        self.assertEqual(format_money(1_000_000), "$1,000,000")

    def test_round_offer(self):
        self.assertEqual(round_offer(0.004), 0.01)
        self.assertEqual(round_offer(47.4), 47)
        self.assertEqual(round_offer(12_345), 12_300)
        self.assertEqual(round_offer(123_456), 123_000)


if __name__ == "__main__":
    unittest.main()

import json
import random
import unittest
import urllib.error
import urllib.request

from deal_or_no_deal import CASE_VALUES, ROUND_SCHEDULE
from deal_or_no_deal_3d import GameSession, start_server


def play_to_final(session):
    session.act("pick", 1)
    for _ in ROUND_SCHEDULE:
        while session.game.phase == "open":
            number = next(n for n in session.game.unopened if n != 1)
            session.act("open", number)
        session.act("no_deal")
    return session


class SessionTests(unittest.TestCase):
    def test_sealed_values_are_never_sent(self):
        session = GameSession(random.Random(3))
        state = session.act("pick", 5)
        self.assertEqual(state["opened"], {})
        self.assertIsNone(state["playerValue"])
        state = session.act("open", 9)
        self.assertEqual(list(state["opened"]), ["9"])
        self.assertEqual(state["opened"]["9"], session.game.cases[9])
        self.assertNotIn("5", state["opened"])

    def test_state_is_valid_json(self):
        session = GameSession(random.Random(3))
        json.dumps(session.act("state"))

    def test_offer_and_last_offer_flag(self):
        session = GameSession(random.Random(4))
        session.act("pick", 1)
        for number in range(2, 2 + ROUND_SCHEDULE[0]):
            state = session.act("open", number)
        self.assertEqual(state["phase"], "offer")
        self.assertEqual(len(state["offers"]), 1)
        self.assertFalse(state["lastOffer"])
        self.assertEqual(state["nextToOpen"], ROUND_SCHEDULE[1])

    def test_final_then_swap_reveals_both_cases(self):
        session = play_to_final(GameSession(random.Random(5)))
        state = session.act("state")
        self.assertEqual(state["phase"], "final")
        self.assertIsNotNone(state["otherCase"])
        state = session.act("swap")
        self.assertEqual(state["phase"], "over")
        self.assertEqual(state["winnings"], state["otherValue"])
        self.assertIn(state["playerValue"], CASE_VALUES)
        self.assertTrue(state["verdict"])

    def test_deal_reveals_only_the_players_case(self):
        session = GameSession(random.Random(6))
        session.act("pick", 1)
        for number in range(2, 2 + ROUND_SCHEDULE[0]):
            session.act("open", number)
        state = session.act("deal")
        self.assertEqual(state["outcome"], "deal")
        self.assertEqual(state["playerValue"], session.game.cases[1])
        self.assertIsNone(state["otherCase"])

    def test_new_game_resets(self):
        session = GameSession(random.Random(7))
        session.act("pick", 3)
        state = session.act("new")
        self.assertEqual(state["phase"], "pick")
        self.assertIsNone(state["playerCase"])

    def test_bad_actions_raise(self):
        session = GameSession(random.Random(8))
        with self.assertRaises(ValueError):
            session.act("open", 2)  # No case picked yet.
        with self.assertRaises(ValueError):
            session.act("cheat")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.server = start_server(GameSession(random.Random(9)))
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, body):
        request = urllib.request.Request(self.url + "/api", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def test_api_round_trip(self):
        self.assertEqual(self.post({"action": "pick", "case": 4})["playerCase"], 4)

    def test_api_rejects_illegal_moves(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post({"action": "deal"})
        self.assertEqual(caught.exception.code, 400)

    def test_serves_the_page(self):
        with urllib.request.urlopen(self.url + "/") as response:
            self.assertIn(b"three.module.min.js", response.read())


if __name__ == "__main__":
    unittest.main()

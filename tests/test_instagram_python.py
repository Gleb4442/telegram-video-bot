import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("instagram_api", Path(__file__).parents[1] / "api/instagram.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class Reply:
    status_code = 200

    def __init__(self, data):
        self.data = data.encode()
        self.closed = False

    def iter_content(self, chunk_size):
        for start in range(0, len(self.data), chunk_size):
            yield self.data[start:start + chunk_size]

    def close(self):
        self.closed = True


class InstagramTests(unittest.TestCase):
    def test_invalid_shortcodes_never_reach_network(self):
        with patch.object(api.requests, "Session") as session:
            for shortcode in ("../foo", "bad?query", "x" * 21, None):
                with self.assertRaises(ValueError):
                    api.extract(shortcode)
            session.assert_not_called()

    def test_bounded_response_closes_after_overflow(self):
        reply = Reply("a" * 1025)
        with self.assertRaises(ValueError):
            api.read_bounded(reply, 1024)
        self.assertTrue(reply.closed)

    def test_query_has_exact_numeric_identity_and_returns_only_required_metadata(self):
        payload = {"data": {"xig_polaris_media": {
            "code": "DeXA5froeiC", "if_not_gated_logged_out": {
                "media_type": 2, "video_versions": [{"url": "https://cdn.example/video.mp4"}],
                "unnecessary_tracking": "omit-me",
            }, "gating_ruling": None,
        }}}
        with patch.object(api.requests, "Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.return_value = Reply('["LSD",[],{"token":"anonymous-token"}')
            session.post.return_value = Reply(json.dumps(payload))
            result = api.extract("DeXA5froeiC")
            args = session.post.call_args.kwargs
            self.assertEqual(json.loads(args["data"]["variables"]), {"media_id": "4005674344597547138"})
            self.assertEqual(args["data"]["doc_id"], "27130156389949648")
            self.assertNotIn("omit-me", json.dumps(result))
            self.assertFalse(factory.call_args.kwargs["allow_redirects"])

    def test_wrong_post_rejected(self):
        with patch.object(api.requests, "Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.return_value = Reply('["LSD",[],{"token":"anonymous-token"}')
            session.post.return_value = Reply('{"data":{"xig_polaris_media":{"code":"other"}}}')
            with self.assertRaises(ValueError):
                api.extract("DeXA5froeiC")

    def test_private_handler_requires_secret_before_reading_or_extracting(self):
        instance = object.__new__(api.handler)
        instance.headers = {"x-telegram-bot-api-secret-token": "wrong"}
        instance.rfile = io.BytesIO(b'{}')
        replies = []
        instance.reply = lambda status, data: replies.append((status, data))
        with patch.dict(api.os.environ, {"TELEGRAM_SECRET_TOKEN": "correct"}), patch.object(api, "extract") as extract:
            instance.do_POST()
            self.assertEqual(replies[0][0], 401)
            self.assertEqual(instance.rfile.tell(), 0)
            extract.assert_not_called()


if __name__ == "__main__":
    unittest.main()

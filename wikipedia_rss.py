#!/usr/bin/env python3
"""Entry point: python3 wikipedia_rss.py [--lang es en] ..."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wikipedia_rss.cli import main  # noqa: E402

sys.exit(main())

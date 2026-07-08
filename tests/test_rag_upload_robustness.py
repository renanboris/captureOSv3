from __future__ import annotations

import unittest
from unittest.mock import patch, MagicMock

from api.rag_engine import (
    sanitizar_namespace,
    split_text_smartly,
    ingerir_documento_para_namespace
)
import api.rag_engine as rag_engine


class TestRagUploadRobustness(unittest.TestCase):
    def test_sanitizar_namespace(self):
        # Happy paths
        self.assertEqual(sanitizar_namespace("auto"), "auto")
        self.assertEqual(sanitizar_namespace("Geral"), "geral")
        self.assertEqual(sanitizar_namespace("   my-namespace   "), "my-namespace")
        
        # Spaces and special characters
        self.assertEqual(sanitizar_namespace("ERP Systems!"), "erp_systems")
        self.assertEqual(sanitizar_namespace("release_notes_2026#v3"), "release_notes_2026v3")
        self.assertEqual(sanitizar_namespace("test.namespace"), "test.namespace")
        
        # Edge cases (empty, only special chars)
        self.assertEqual(sanitizar_namespace(""), "geral")
        self.assertEqual(sanitizar_namespace("   "), "geral")
        self.assertEqual(sanitizar_namespace("###!!!"), "geral")

    def test_split_text_smartly_small(self):
        text = "This is a small text."
        chunks = split_text_smartly(text, chunk_size=100)
        self.assertEqual(chunks, ["This is a small text."])

    def test_split_text_smartly_paragraphs(self):
        # Paragraphs fit nicely in chunk_size=25
        text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
        chunks = split_text_smartly(text, chunk_size=25, chunk_overlap=5)
        
        # They should split cleanly without breaking words
        self.assertTrue(len(chunks) >= 3)
        self.assertIn("Paragraph one.", chunks[0])
        self.assertIn("Paragraph two.", chunks[1])
        self.assertIn("Paragraph three.", chunks[2])

    def test_split_text_smartly_overlap(self):
        text = "This is the first sentence that is somewhat long. And this is the second sentence that is also long."
        # Split with chunk_size=60, overlap=25
        chunks = split_text_smartly(text, chunk_size=60, chunk_overlap=25)
        
        self.assertTrue(len(chunks) > 1)
        # Check that the second chunk starts with the overlap from the first chunk
        first_chunk_end = chunks[0][-15:]
        second_chunk_start = chunks[1][:30]
        # Overlap should carry some semantic content from the previous chunk
        self.assertTrue(any(word in second_chunk_start for word in ["sentence", "long", "first"]))

    @patch("api.rag_engine.client_openai")
    @patch("api.rag_engine.pinecone_index")
    @patch("api.rag_engine.gerar_embedding")
    @patch("api.rag_engine.extrair_texto_documento")
    def test_cache_invalidation_on_ingestion(self, mock_extrair, mock_gerar_embed, mock_pinecone, mock_openai):
        # Setup mocks
        mock_extrair.return_value = "Release Notes: Novo modulo financeiro."
        mock_gerar_embed.return_value = [0.1] * 3072
        mock_pinecone.upsert.return_value = True
        
        # Force cache to true first
        rag_engine._NAMESPACES_LOADED = True
        
        resultado = ingerir_documento_para_namespace(
            file_data_b64="dummy_base64",
            filename="release.txt",
            namespace="new_namespace"
        )
        
        self.assertTrue(resultado["success"])
        self.assertEqual(resultado["namespace"], "new_namespace")
        self.assertEqual(resultado["chunks"], 1)
        
        # Verify cache has been invalidated (set to False)
        self.assertFalse(rag_engine._NAMESPACES_LOADED)
        
        # Verify upsert called with sanitized namespace
        mock_pinecone.upsert.assert_called_once()
        kwargs = mock_pinecone.upsert.call_args[1]
        self.assertEqual(kwargs["namespace"], "new_namespace")

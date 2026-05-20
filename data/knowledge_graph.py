import sqlite3
import json
import hashlib
from typing import List, Dict, Optional, Tuple
from contracts.state_models import SemanticSnapshot, ActionDecision

class KnowledgeGraph:
    def __init__(self, db_path: str = "brain.db"):
        self.conn = sqlite3.connect(db_path)
        self._init_db()

    def _init_db(self):
        cursor = self.conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS states (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                nodes_json TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS transitions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_state_id TEXT,
                to_state_id TEXT,
                action TEXT,
                som_id TEXT,
                reasoning TEXT,
                FOREIGN KEY(from_state_id) REFERENCES states(id),
                FOREIGN KEY(to_state_id) REFERENCES states(id)
            )
        ''')
        self.conn.commit()

    def _hash_state(self, snapshot: SemanticSnapshot) -> str:
        """Gera um hash único para o estado da tela baseado na URL e na árvore semântica."""
        # Simple representation of nodes for hashing
        nodes_repr = "|".join([f"{n.tag}:{n.role}:{n.text}" for n in snapshot.nodes])
        content = f"{snapshot.url}::{nodes_repr}"
        return hashlib.md5(content.encode('utf-8')).hexdigest()

    def save_state(self, snapshot: SemanticSnapshot) -> str:
        state_id = self._hash_state(snapshot)
        cursor = self.conn.cursor()
        
        # Check if exists
        cursor.execute('SELECT id FROM states WHERE id = ?', (state_id,))
        if cursor.fetchone() is None:
            nodes_json = json.dumps([n.model_dump() for n in snapshot.nodes])
            cursor.execute('''
                INSERT INTO states (id, url, title, nodes_json)
                VALUES (?, ?, ?, ?)
            ''', (state_id, snapshot.url, snapshot.title, nodes_json))
            self.conn.commit()
            
        return state_id

    def add_transition(self, from_snapshot: SemanticSnapshot, to_snapshot: SemanticSnapshot, action: ActionDecision):
        from_id = self.save_state(from_snapshot)
        to_id = self.save_state(to_snapshot)
        
        cursor = self.conn.cursor()
        cursor.execute('''
            INSERT INTO transitions (from_state_id, to_state_id, action, som_id, reasoning)
            VALUES (?, ?, ?, ?, ?)
        ''', (from_id, to_id, action.action, action.som_id, action.reasoning))
        self.conn.commit()

    def find_path(self, current_snapshot: SemanticSnapshot, goal: str) -> List[str]:
        """
        Busca um caminho no grafo até um estado que atenda ao objetivo.
        Para a POC, retorna hints textuais baseados nas transições conhecidas.
        """
        current_id = self._hash_state(current_snapshot)
        cursor = self.conn.cursor()
        
        # Encontra transições a partir do estado atual
        cursor.execute('''
            SELECT action, som_id, reasoning FROM transitions 
            WHERE from_state_id = ?
        ''', (current_id,))
        
        transitions = cursor.fetchall()
        hints = []
        for t in transitions:
            hints.append(f"Ação conhecida: {t[0]} no SoM {t[1]} (Motivo: {t[2]})")
            
        return hints

    def close(self):
        self.conn.close()

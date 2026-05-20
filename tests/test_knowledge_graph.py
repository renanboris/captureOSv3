import os
import pytest
from contracts.state_models import SemanticSnapshot, A11yNode, A11yNodeState, ActionDecision
from data.knowledge_graph import KnowledgeGraph

@pytest.fixture
def graph():
    # Use memory database or a test file
    test_db = "test_brain.db"
    g = KnowledgeGraph(db_path=test_db)
    yield g
    g.close()
    if os.path.exists(test_db):
        os.remove(test_db)

def test_save_state(graph):
    node = A11yNode(tag="a", text="Link", state=A11yNodeState())
    snap = SemanticSnapshot(url="https://test", title="Test", nodes=[node])
    
    state_id = graph.save_state(snap)
    assert state_id is not None
    
    # saving again should return same id
    state_id2 = graph.save_state(snap)
    assert state_id == state_id2

def test_add_transition(graph):
    node1 = A11yNode(tag="a", text="Link", state=A11yNodeState())
    snap1 = SemanticSnapshot(url="https://test", title="Test", nodes=[node1])
    
    node2 = A11yNode(tag="div", text="Result", state=A11yNodeState())
    snap2 = SemanticSnapshot(url="https://test2", title="Test 2", nodes=[node2])
    
    action = ActionDecision(action="click", som_id="1", reasoning="Test click")
    
    graph.add_transition(snap1, snap2, action)
    
    # Check if hint works
    hints = graph.find_path(snap1, "Go to result")
    assert len(hints) == 1
    assert "Test click" in hints[0]

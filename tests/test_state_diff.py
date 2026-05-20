from contracts.state_models import SemanticSnapshot, A11yNode, A11yNodeState
from capture.state_diff import StateDiffEngine

def test_detect_navigation():
    engine = StateDiffEngine()
    
    before = SemanticSnapshot(url="https://url1", title="Title 1", nodes=[])
    after = SemanticSnapshot(url="https://url2", title="Title 2", nodes=[])
    
    diff = engine.detect(before, after)
    assert diff.changed is True
    assert diff.change_type == "navigation"

def test_detect_dom_mutation_added_node():
    engine = StateDiffEngine()
    
    node1 = A11yNode(tag="button", text="Btn 1", state=A11yNodeState())
    node2 = A11yNode(tag="button", text="Btn 2", state=A11yNodeState())
    
    before = SemanticSnapshot(url="https://url1", title="Title", nodes=[node1])
    after = SemanticSnapshot(url="https://url1", title="Title", nodes=[node1, node2])
    
    diff = engine.detect(before, after)
    assert diff.changed is True
    assert diff.change_type == "dom_mutation"
    assert len(diff.added_nodes) == 1
    assert diff.added_nodes[0].text == "Btn 2"

def test_detect_dom_mutation_state_change():
    engine = StateDiffEngine()
    
    before_state = A11yNodeState(expanded="false")
    node_before = A11yNode(tag="div", role="menu", text="Menu", state=before_state)
    
    after_state = A11yNodeState(expanded="true")
    node_after = A11yNode(tag="div", role="menu", text="Menu", state=after_state)
    
    before = SemanticSnapshot(url="https://url1", title="Title", nodes=[node_before])
    after = SemanticSnapshot(url="https://url1", title="Title", nodes=[node_after])
    
    diff = engine.detect(before, after)
    assert diff.changed is True
    assert diff.change_type == "dom_mutation"
    assert len(diff.modified_nodes) == 1
    assert diff.modified_nodes[0]["new_state"]["expanded"] == "true"

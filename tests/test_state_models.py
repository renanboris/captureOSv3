from contracts.state_models import A11yNode, A11yNodeState, SemanticSnapshot, StateChange, ActionDecision

def test_a11y_node_creation():
    state = A11yNodeState(expanded="true", disabled=False, checked=True)
    node = A11yNode(som_id="1", tag="button", role="menuitem", text="Relatórios", state=state)
    
    assert node.som_id == "1"
    assert node.tag == "button"
    assert node.state.expanded == "true"
    assert node.state.checked is True

def test_semantic_snapshot_creation():
    state = A11yNodeState(disabled=False)
    node = A11yNode(som_id="2", tag="a", role="link", text="Home", state=state)
    
    snapshot = SemanticSnapshot(url="https://seniorx", title="Senior X Home", nodes=[node])
    assert len(snapshot.nodes) == 1
    assert snapshot.nodes[0].text == "Home"

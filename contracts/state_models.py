from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class A11yNodeState(BaseModel):
    expanded: Optional[str] = None
    disabled: bool = False
    checked: bool = False

class A11yNode(BaseModel):
    som_id: Optional[str] = None
    tag: str
    role: str = ""
    text: str = ""
    state: A11yNodeState

class SemanticSnapshot(BaseModel):
    url: str
    title: str
    nodes: List[A11yNode] = Field(default_factory=list)

class StateChange(BaseModel):
    changed: bool
    change_type: str
    change_summary: str
    added_nodes: List[A11yNode] = Field(default_factory=list)
    removed_nodes: List[A11yNode] = Field(default_factory=list)
    modified_nodes: List[Dict[str, Any]] = Field(default_factory=list)

class ActionDecision(BaseModel):
    action: str
    som_id: Optional[str] = None
    reasoning: str

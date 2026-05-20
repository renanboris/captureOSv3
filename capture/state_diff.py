from typing import Dict, Any, List
from contracts.state_models import SemanticSnapshot, StateChange, A11yNode

class StateDiffEngine:
    def detect(self, before: SemanticSnapshot, after: SemanticSnapshot) -> StateChange:
        if before.url != after.url:
            return StateChange(
                changed=True,
                change_type="navigation",
                change_summary=f"Mudou de URL: {before.url} -> {after.url}"
            )
            
        before_nodes = {self._node_key(n): n for n in before.nodes}
        after_nodes = {self._node_key(n): n for n in after.nodes}
        
        added = []
        removed = []
        modified = []
        
        for k, n in after_nodes.items():
            if k not in before_nodes:
                added.append(n)
            else:
                # check for state changes
                old_n = before_nodes[k]
                if n.state.model_dump() != old_n.state.model_dump():
                    modified.append({
                        "node": n.model_dump(),
                        "old_state": old_n.state.model_dump(),
                        "new_state": n.state.model_dump()
                    })
                    
        for k, n in before_nodes.items():
            if k not in after_nodes:
                removed.append(n)
                
        if added or removed or modified:
            summary_parts = []
            if added:
                summary_parts.append(f"{len(added)} novos nós apareceram na tela")
            if removed:
                summary_parts.append(f"{len(removed)} nós sumiram")
            if modified:
                summary_parts.append(f"{len(modified)} nós mudaram de estado (ex: expanded, checked)")
                
            return StateChange(
                changed=True,
                change_type="dom_mutation",
                change_summary="; ".join(summary_parts),
                added_nodes=added,
                removed_nodes=removed,
                modified_nodes=modified
            )

        if before.title != after.title:
            return StateChange(
                changed=True,
                change_type="screen_change",
                change_summary=f"Título da tela mudou: {before.title} -> {after.title}"
            )

        return StateChange(
            changed=False,
            change_type="none",
            change_summary="Nenhuma mudança estrutural detectada."
        )
        
    def _node_key(self, node: A11yNode) -> str:
        # Use text + tag + role as a weak unique identifier since som_id might change between re-renders
        return f"{node.tag}|{node.role}|{node.text}"

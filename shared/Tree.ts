export type TreeNode<T> = T & {
  children: TreeNode<T>[];
  parent: TreeNode<T> | null;
  get siblings(): TreeNode<T>[];
};

interface TreeElement {
  id: string;
  parent_message_id: string | null;
}

class Tree<T extends TreeElement> {
  allNodes: Map<string, TreeNode<T>> = new Map();
  rootNodes: TreeNode<T>[] = [];

  constructor(elements: T[]) {
    const nodes: Map<string, TreeNode<T>> = new Map(); // UUID -> node
    const rootNodes: TreeNode<T>[] = [];
    // First pass: Create all nodes
    elements.forEach((element) => {
      const node: TreeNode<T> = {
        ...element,
        children: [],
        parent: null,
        get siblings() {
          return this.parent ? this.parent.children : rootNodes;
        },
      };
      nodes.set(element.id, node);
    });

    // Second pass: Build parent-child relationships
    elements.forEach((element) => {
      const node = nodes.get(element.id);
      if (node) {
        if (element.parent_message_id) {
          const parentNode = nodes.get(element.parent_message_id);
          if (parentNode) {
            parentNode.children.push(node);
            node.parent = parentNode;
          }
        } else {
          // No parent means this is a root node
          rootNodes.push(node);
        }
      }
    });

    this.allNodes = nodes;
    this.rootNodes = rootNodes;
  }

  getPath(id: string): TreeNode<T>[] {
    const path: TreeNode<T>[] = [];
    // Visited-set defense against `parent_message_id` cycles in the data
    // (e.g. a row that points at itself). Without this guard `getPath`
    // walks the chain forever and locks the entire UI. The server contract
    // shouldn't allow cycles to land in the DB, but the tree is rendered
    // straight from a Supabase query so we treat it as untrusted.
    const visited = new Set<string>();
    let currentNode = this.allNodes.get(id);

    while (currentNode) {
      if (visited.has(currentNode.id)) {
        console.warn(
          `[Tree.getPath] cycle detected at message ${currentNode.id} — truncating walk`,
        );
        break;
      }
      visited.add(currentNode.id);
      path.unshift(currentNode);
      if (currentNode.parent) {
        currentNode = currentNode.parent;
      } else {
        break;
      }
    }

    return path;
  }
}

export default Tree;

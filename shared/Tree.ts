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
    let currentNode = this.allNodes.get(id);

    while (currentNode) {
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

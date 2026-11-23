/**
 * fileTreeUtils.js
 * High-performance, immutable tree operations for optimistic file & folder mutations.
 */

export function sortTreeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return [...nodes]
    .sort((a, b) => {
      // Folders first
      const aIsFolder = a.type === "folder";
      const bIsFolder = b.type === "folder";
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    })
    .map((node) => {
      if (node.children && Array.isArray(node.children)) {
        return {
          ...node,
          children: sortTreeNodes(node.children),
        };
      }
      return node;
    });
}

function normalizePath(p = "") {
  return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Optimistically insert a file or folder into the fileTree.
 * Returns a new tree with the new node inserted and properly sorted.
 */
export function insertNodeIntoTree(tree = [], targetPath = "", isFolder = false) {
  const normPath = normalizePath(targetPath);
  if (!normPath) return tree;

  const parts = normPath.split("/");
  const fileName = parts[parts.length - 1];

  function insertRecursive(nodes, currentDepth, currentPrefix) {
    const isTargetLevel = currentDepth === parts.length - 1;
    const currentPart = parts[currentDepth];
    const nextPrefix = currentPrefix ? `${currentPrefix}/${currentPart}` : currentPart;

    if (isTargetLevel) {
      // Check if item already exists
      const exists = nodes.some((n) => n.id === normPath || n.name === fileName);
      if (exists) return nodes;

      const newNode = {
        id: normPath,
        name: fileName,
        type: isFolder ? "folder" : "file",
        ...(isFolder ? { children: [] } : {}),
      };

      return sortTreeNodes([...nodes, newNode]);
    }

    // Traverse into or create folder for currentPart
    let folderFound = false;
    const nextNodes = nodes.map((node) => {
      if (node.name === currentPart && node.type === "folder") {
        folderFound = true;
        return {
          ...node,
          children: insertRecursive(node.children || [], currentDepth + 1, nextPrefix),
        };
      }
      return node;
    });

    if (!folderFound) {
      const newFolder = {
        id: nextPrefix,
        name: currentPart,
        type: "folder",
        children: insertRecursive([], currentDepth + 1, nextPrefix),
      };
      return sortTreeNodes([...nextNodes, newFolder]);
    }

    return nextNodes;
  }

  return insertRecursive(tree, 0, "");
}

/**
 * Optimistically rename a file or folder in the tree.
 * Handles nested children path renaming and moves across folders.
 */
export function renameNodeInTree(tree = [], oldPath = "", newPath = "") {
  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);
  if (!normOld || !normNew || normOld === normNew) return tree;

  const newName = normNew.split("/").pop();

  // Helper to recursively update IDs for children
  function updateDescendantIds(node, oldPrefix, newPrefix) {
    const updatedId = node.id.startsWith(oldPrefix)
      ? `${newPrefix}${node.id.slice(oldPrefix.length)}`
      : node.id;

    return {
      ...node,
      id: updatedId,
      children: node.children
        ? node.children.map((c) => updateDescendantIds(c, oldPrefix, newPrefix))
        : undefined,
    };
  }

  function renameRecursive(nodes) {
    return nodes.map((node) => {
      if (node.id === normOld) {
        const renamed = {
          ...node,
          id: normNew,
          name: newName,
        };
        if (renamed.type === "folder" && renamed.children) {
          renamed.children = renamed.children.map((c) =>
            updateDescendantIds(c, normOld, normNew)
          );
        }
        return renamed;
      }

      if (node.children) {
        return {
          ...node,
          children: renameRecursive(node.children),
        };
      }

      return node;
    });
  }

  // Check if parent directory changed
  const oldParent = normOld.includes("/") ? normOld.slice(0, normOld.lastIndexOf("/")) : "";
  const newParent = normNew.includes("/") ? normNew.slice(0, normNew.lastIndexOf("/")) : "";

  if (oldParent === newParent) {
    // In-place rename
    return sortTreeNodes(renameRecursive(tree));
  }

  // Moved to different parent: find node, remove from old, insert to new
  let extractedNode = null;
  function extractRecursive(nodes) {
    const res = [];
    for (const node of nodes) {
      if (node.id === normOld) {
        extractedNode = {
          ...node,
          id: normNew,
          name: newName,
        };
        if (extractedNode.type === "folder" && extractedNode.children) {
          extractedNode.children = extractedNode.children.map((c) =>
            updateDescendantIds(c, normOld, normNew)
          );
        }
      } else {
        res.push({
          ...node,
          children: node.children ? extractRecursive(node.children) : undefined,
        });
      }
    }
    return res;
  }

  const prunedTree = extractRecursive(tree);
  if (!extractedNode) return tree;

  return insertNodeIntoTree(prunedTree, normNew, extractedNode.type === "folder");
}

/**
 * Optimistically delete a file or folder from the tree.
 */
export function deleteNodeFromTree(tree = [], targetPath = "") {
  const normPath = normalizePath(targetPath);
  if (!normPath) return tree;

  function filterRecursive(nodes) {
    return nodes
      .filter((node) => node.id !== normPath && !node.id.startsWith(`${normPath}/`))
      .map((node) => ({
        ...node,
        children: node.children ? filterRecursive(node.children) : undefined,
      }));
  }

  return filterRecursive(tree);
}


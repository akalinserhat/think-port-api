import React from 'react';

export interface TreeItem {
    id: string | number;
    children?: TreeItem[];
    [key: string]: any;
}

export interface BaseTreeViewProps {
    data: TreeItem[];
    renderItem: (item: TreeItem, level: number, isExpanded: boolean, onToggleExpand: () => void) => React.ReactNode;
    isItemExpanded?: (item: TreeItem) => boolean;
}

const TreeViewNode: React.FC<{
    item: TreeItem;
    level: number;
    renderItem: BaseTreeViewProps['renderItem'];
    isItemExpanded?: BaseTreeViewProps['isItemExpanded'];
}> = ({ item, level, renderItem, isItemExpanded }) => {
    const hasChildren = item.children && item.children.length > 0;
    const initialExpanded = isItemExpanded ? isItemExpanded(item) : false;
    const [isExpanded, setIsExpanded] = React.useState(initialExpanded);

    React.useEffect(() => {
        if (isItemExpanded) {
            setIsExpanded(isItemExpanded(item));
        }
    }, [isItemExpanded, item]);

    const handleToggleExpand = () => {
        if (hasChildren) {
            setIsExpanded(!isExpanded);
        }
    };

    return (
        <div className="flex flex-col w-full">
            {renderItem(item, level, isExpanded, handleToggleExpand)}
            
            {hasChildren && (
                <div 
                    className="flex flex-col w-full overflow-hidden transition-all duration-300"
                    style={{ 
                        maxHeight: isExpanded ? '2000px' : '0', 
                        opacity: isExpanded ? 1 : 0 
                    }}
                >
                    {item.children!.map((child) => (
                        <TreeViewNode 
                            key={child.id} 
                            item={child} 
                            level={level + 1} 
                            renderItem={renderItem}
                            isItemExpanded={isItemExpanded}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const BaseTreeView: React.FC<BaseTreeViewProps> = ({ data, renderItem, isItemExpanded }) => {
    return (
        <div className="flex flex-col w-full">
            {data.map(item => (
                <TreeViewNode 
                    key={item.id} 
                    item={item} 
                    level={0} 
                    renderItem={renderItem}
                    isItemExpanded={isItemExpanded}
                />
            ))}
        </div>
    );
};

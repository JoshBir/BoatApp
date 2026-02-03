import React, { useState } from 'react';
import { componentSpecs, componentPalette, categoryLabels } from '../../data/components';
import { ComponentType } from '../../types';

interface ComponentSidebarProps {
  onDragStart: (event: React.DragEvent, nodeType: ComponentType) => void;
}

export const ComponentSidebar: React.FC<ComponentSidebarProps> = ({ onDragStart }) => {
  // Track which categories are expanded (all expanded by default)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(
    Object.keys(componentPalette).reduce((acc, cat) => ({ ...acc, [cat]: true }), {})
  );
  
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };
  
  return (
    <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 bg-marine-blue text-white">
        <h2 className="text-lg font-bold">⚡ Components</h2>
        <p className="text-xs text-blue-200 mt-1">Drag to canvas</p>
      </div>
      
      <div className="p-2">
        {Object.entries(componentPalette).map(([category, components]) => (
          <div key={category} className="mb-2">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 mb-1 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
            >
              <span>{categoryLabels[category]}</span>
              <span className={`transform transition-transform ${expandedCategories[category] ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>
            {expandedCategories[category] && <div className="space-y-1">
              {components.map(componentId => {
                const spec = componentSpecs[componentId];
                if (!spec) return null;
                
                return (
                  <div
                    key={componentId}
                    className="flex items-center gap-2 p-2 rounded cursor-grab hover:bg-gray-100 active:bg-gray-200 transition-colors border border-transparent hover:border-gray-300"
                    draggable
                    onDragStart={(e) => onDragStart(e, componentId as ComponentType)}
                  >
                    <span className="text-lg">{spec.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {spec.name}
                      </div>
                      {spec.maxCurrent && (
                        <div className="text-xs text-gray-500">{spec.maxCurrent}A</div>
                      )}
                      {spec.capacity && (
                        <div className="text-xs text-gray-500">{spec.capacity}Ah</div>
                      )}
                      {spec.wattage && (
                        <div className="text-xs text-gray-500">{spec.wattage}W</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        ))}
      </div>
    </aside>
  );
};

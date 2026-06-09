import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CheckCircle } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  plant_name: string;
  completed: boolean;
}

interface ProjectSelectorProps {
  projects: Project[];
  selectedProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  placeholder?: string;
  className?: string;
}

export function ProjectSelector({ 
  projects, 
  selectedProjectId, 
  onProjectSelect,
  placeholder = "Select a project",
  className = ""
}: ProjectSelectorProps) {
  return (
    <Select value={selectedProjectId || ''} onValueChange={onProjectSelect}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex items-center justify-between w-full">
              <span>{project.name}</span>
              <div className="flex items-center space-x-1 ml-2">
                <Badge variant="outline" className="text-xs">
                  {project.plant_name}
                </Badge>
                {project.completed && (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                )}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
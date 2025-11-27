import React, { useEffect, useState } from 'react';
import { Parameter } from '@shared/types';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  validateParameterValue,
  isMeasurementParameter,
} from '@/utils/parameterUtils';
import { ParameterSlider } from '@/components/parameter/ParameterSlider';
import { Label } from '@/components/ui/label';

export function ParameterInput({
  param,
  handleCommit,
}: {
  param: Parameter;
  handleCommit: (param: Parameter, value: Parameter['value']) => void;
}) {
  const [paramState, setParamState] = useState<Parameter>(param);

  useEffect(() => {
    setParamState(param);
  }, [param]);

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const handleValueChange = (value: Parameter['value']) => {
    setParamState({ ...paramState, value });
  };

  const handleValueCommit = (value: Parameter['value']) => {
    setParamState({ ...paramState, value });
    handleCommit(paramState, value);
  };

  if (!paramState.type || paramState.type === 'number') {
    return (
      <div className="grid w-full grid-cols-[80px_1fr] items-center gap-3">
        <Label
          className="overflow-hidden text-ellipsis text-xs font-normal text-adam-neutral-300"
          htmlFor={paramState.name}
        >
          {paramState.displayName}
        </Label>
        <div className="flex w-full items-center gap-3">
          <ParameterSlider
            param={paramState}
            onValueChange={handleValueChange}
            onValueCommit={handleValueCommit}
          />
          <div className="flex flex-shrink-0 items-center gap-2">
            <Input
              id={paramState.name}
              name={paramState.name}
              autoComplete="off"
              className="h-6 w-14 rounded-lg bg-adam-neutral-800 px-2 text-left text-xs text-adam-text-primary transition-colors selection:bg-adam-blue/50 selection:text-white focus:outline-none [@media(hover:hover)]:hover:bg-adam-neutral-700"
              value={String(paramState.value)}
              onKeyDown={onEnter}
              onChange={(e) => handleValueChange(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                handleValueCommit(
                  validateParameterValue(paramState, paramState.value),
                );
              }}
            />
            <span className="ml-1 w-6 text-left text-xs text-adam-neutral-300">
              {isMeasurementParameter(paramState) ? 'mm' : ''}
            </span>
          </div>
        </div>
      </div>
    );
  }
  if (param.type === 'boolean') {
    return (
      <div className="grid w-full grid-cols-[80px_1fr] items-center gap-3">
        <Label
          className="overflow-hidden text-ellipsis text-xs font-normal text-adam-neutral-300"
          htmlFor={paramState.name}
        >
          {paramState.displayName}
        </Label>
        <Switch
          id={paramState.name}
          name={paramState.name}
          checked={Boolean(paramState.value)}
          onCheckedChange={(checked) => handleValueCommit(checked)}
        />
      </div>
    );
  }
  if (param.type === 'string') {
    return (
      <div className="grid w-full grid-cols-[80px_1fr] items-center gap-3">
        <Label
          className="overflow-hidden text-ellipsis text-xs font-normal text-adam-neutral-300"
          htmlFor={paramState.name}
        >
          {paramState.displayName}
        </Label>
        <Input
          id={paramState.name}
          name={paramState.name}
          autoComplete="off"
          className="h-6 w-full min-w-0 rounded-md bg-adam-neutral-800 px-2 text-left text-xs text-adam-text-primary transition-colors selection:bg-adam-blue/50 selection:text-white focus:outline-none [@media(hover:hover)]:hover:bg-adam-neutral-700"
          value={String(paramState.value)}
          onChange={(e) => handleValueChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => handleValueCommit(paramState.value)}
          onKeyDown={onEnter}
        />
      </div>
    );
  }
  if (paramState.type === 'string[]') {
    if (Array.isArray(paramState.value)) {
      return (
        <div className="grid w-full grid-cols-[80px_1fr] items-start gap-3">
          <Label
            className="overflow-hidden text-ellipsis pt-2 text-xs font-normal text-adam-neutral-300"
            htmlFor={paramState.name}
          >
            {paramState.displayName}
          </Label>
          <div className="flex w-full flex-col gap-2">
            {paramState.value.map((value, index) => (
              <Input
                key={index}
                id={`${paramState.name}-${index}`}
                name={paramState.name}
                autoComplete="off"
                className="h-6 w-full min-w-0 rounded-md bg-adam-neutral-800 px-2 text-left text-xs text-adam-text-primary transition-colors selection:bg-adam-blue/50 selection:text-white focus:outline-none [@media(hover:hover)]:hover:bg-adam-neutral-700"
                value={String(value)}
                onKeyDown={onEnter}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleValueChange(
                    (paramState.value as string[]).map(
                      (itemValue, itemIndex) =>
                        itemIndex === index ? e.target.value : itemValue,
                    ),
                  )
                }
                onBlur={(e) =>
                  handleValueCommit(
                    (paramState.value as string[]).map(
                      (itemValue, itemIndex) =>
                        itemIndex === index ? e.target.value : itemValue,
                    ),
                  )
                }
              />
            ))}
          </div>
        </div>
      );
    }
  }
  if (paramState.type === 'number[]') {
    if (Array.isArray(paramState.value)) {
      return (
        <div className="grid w-full grid-cols-[80px_1fr] items-start gap-3">
          <Label
            className="overflow-hidden text-ellipsis pt-2 text-xs font-normal text-adam-neutral-300"
            htmlFor={paramState.name}
          >
            {paramState.displayName}
          </Label>
          <div className="flex w-full flex-col gap-2">
            {paramState.value.map((value, index) => {
              const itemParam = {
                ...paramState,
                defaultValue: Array.isArray(paramState.defaultValue)
                  ? paramState.defaultValue[index]
                  : paramState.defaultValue,
                value: value,
              };

              return (
                <div key={index} className="flex w-full items-center gap-3">
                  <ParameterSlider
                    param={itemParam}
                    onValueChange={(newValue) =>
                      handleValueChange(
                        (paramState.value as number[]).map(
                          (itemValue, itemIndex) =>
                            itemIndex === index ? newValue : itemValue,
                        ),
                      )
                    }
                    onValueCommit={(newValue) =>
                      handleValueCommit(
                        (paramState.value as number[]).map(
                          (itemValue, itemIndex) =>
                            itemIndex === index ? newValue : itemValue,
                        ),
                      )
                    }
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${paramState.name}-${index}`}
                      name={paramState.name}
                      autoComplete="off"
                      className="h-6 w-14 rounded-md bg-adam-neutral-800 px-2 text-left text-xs text-adam-text-primary transition-colors selection:bg-adam-blue/50 selection:text-white focus:outline-none [@media(hover:hover)]:hover:bg-adam-neutral-700"
                      value={String(value)}
                      onKeyDown={onEnter}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        handleValueChange(
                          (paramState.value as number[]).map(
                            (itemValue, itemIndex) =>
                              itemIndex === index
                                ? (e.target.value as unknown as number)
                                : itemValue,
                          ),
                        )
                      }
                      onBlur={(e) => {
                        const updatedValue = (paramState.value as number[]).map(
                          (itemValue, itemIndex) => {
                            if (itemIndex === index) {
                              return validateParameterValue(
                                itemParam,
                                e.target.value,
                              );
                            }
                            return itemValue;
                          },
                        );
                        handleValueCommit(updatedValue as Parameter['value']);
                      }}
                    />
                    <span className="w-6 text-left text-xs text-adam-neutral-300">
                      {isMeasurementParameter(paramState) ? 'mm' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }
  if (paramState.type === 'boolean[]') {
    if (Array.isArray(paramState.value)) {
      return (
        <div className="grid w-full grid-cols-[80px_1fr] items-start gap-3">
          <Label
            className="overflow-hidden text-ellipsis pt-2 text-xs font-normal text-adam-neutral-300"
            htmlFor={paramState.name}
          >
            {paramState.displayName}
          </Label>
          <div className="flex w-full flex-col gap-2">
            {paramState.value.map((value, index) => (
              <Switch
                key={index}
                id={`${paramState.name}-${index}`}
                name={paramState.name}
                checked={Boolean(value)}
                onCheckedChange={(checked) =>
                  handleValueCommit(
                    (paramState.value as boolean[]).map(
                      (itemValue, itemIndex) =>
                        itemIndex === index ? checked : itemValue,
                    ),
                  )
                }
              />
            ))}
          </div>
        </div>
      );
    }
  }
}

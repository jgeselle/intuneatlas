import assert from "node:assert/strict";
import { test } from "node:test";
import { collectSlots, slotsOfInstance, withTemplateReferences, type TemplateSlot } from "../../src/push/templates.js";

const T = "#microsoft.graph.deviceManagementConfiguration";

// A group setting from a live tenant's Defender Antivirus template, trimmed: slots nest.
const template = [
  { settingInstanceTemplate: { "@odata.type": `${T}ChoiceSettingInstanceTemplate`, settingInstanceTemplateId: "i-cloud", settingDefinitionId: "cloud", choiceSettingValueTemplate: { defaultValue: null, settingValueTemplateId: "v-cloud" } } },
  { settingInstanceTemplate: { "@odata.type": `${T}SimpleSettingCollectionInstanceTemplate`, settingInstanceTemplateId: "i-ext", settingDefinitionId: "extensions", simpleSettingCollectionValueTemplate: [{ settingValueTemplateId: "v-ext" }] } },
  {
    settingInstanceTemplate: {
      "@odata.type": `${T}GroupSettingCollectionInstanceTemplate`,
      settingInstanceTemplateId: "i-threat",
      settingDefinitionId: "threat",
      groupSettingCollectionValueTemplate: [
        { settingValueTemplateId: "v-threat", children: [{ "@odata.type": `${T}ChoiceSettingInstanceTemplate`, settingInstanceTemplateId: "i-high", settingDefinitionId: "threat_high", choiceSettingValueTemplate: { settingValueTemplateId: "v-high" } }] },
      ],
    },
  },
];

test("collectSlots: every slot of a template, nested ones included", () => {
  const slots = new Map<string, TemplateSlot>();
  collectSlots(template, slots);
  assert.deepEqual(Object.fromEntries(slots), {
    cloud: { instanceTemplateId: "i-cloud", valueTemplateId: "v-cloud" },
    extensions: { instanceTemplateId: "i-ext", valueTemplateId: "v-ext" },
    threat: { instanceTemplateId: "i-threat", valueTemplateId: "v-threat" },
    threat_high: { instanceTemplateId: "i-high", valueTemplateId: "v-high" },
  });
});

test("withTemplateReferences: a rebuilt instance names its slots again, at every level", () => {
  const slots = new Map<string, TemplateSlot>();
  collectSlots(template, slots);
  const rebuilt = {
    "@odata.type": `${T}GroupSettingCollectionInstance`,
    settingDefinitionId: "threat",
    groupSettingCollectionValue: [
      { children: [{ "@odata.type": `${T}ChoiceSettingInstance`, settingDefinitionId: "threat_high", choiceSettingValue: { "@odata.type": `${T}ChoiceSettingValue`, value: "threat_high_block", children: [] } }] },
    ],
  };

  assert.deepEqual(withTemplateReferences(rebuilt, slots), {
    "@odata.type": `${T}GroupSettingCollectionInstance`,
    settingDefinitionId: "threat",
    settingInstanceTemplateReference: { settingInstanceTemplateId: "i-threat" },
    groupSettingCollectionValue: [
      {
        settingValueTemplateReference: { settingValueTemplateId: "v-threat" },
        children: [
          {
            "@odata.type": `${T}ChoiceSettingInstance`,
            settingDefinitionId: "threat_high",
            settingInstanceTemplateReference: { settingInstanceTemplateId: "i-high" },
            choiceSettingValue: { "@odata.type": `${T}ChoiceSettingValue`, value: "threat_high_block", children: [], settingValueTemplateReference: { settingValueTemplateId: "v-high" } },
          },
        ],
      },
    ],
  });

  // The items of a plain list carry no reference of their own — only the list does.
  const list = { "@odata.type": `${T}SimpleSettingCollectionInstance`, settingDefinitionId: "extensions", simpleSettingCollectionValue: [{ "@odata.type": `${T}StringSettingValue`, value: "tmp" }] };
  assert.deepEqual(withTemplateReferences(list, slots), { ...list, settingInstanceTemplateReference: { settingInstanceTemplateId: "i-ext" } });

  // A setting the template doesn't know is left as it is.
  const unknown = { "@odata.type": `${T}SimpleSettingInstance`, settingDefinitionId: "elsewhere", simpleSettingValue: { value: 1 } };
  assert.deepEqual(withTemplateReferences(unknown, slots), unknown);
});

test("slotsOfInstance: what a stored instance already says about its slots", () => {
  const stored = {
    settingDefinitionId: "cloud",
    settingInstanceTemplateReference: { settingInstanceTemplateId: "i-cloud" },
    choiceSettingValue: {
      value: "cloud_2",
      settingValueTemplateReference: { settingValueTemplateId: "v-cloud", useTemplateDefault: false },
      children: [{ settingDefinitionId: "cloud_child", settingInstanceTemplateReference: { settingInstanceTemplateId: "i-child" }, simpleSettingValue: { value: 1, settingValueTemplateReference: null } }],
    },
  };
  assert.deepEqual(Object.fromEntries(slotsOfInstance(stored)), {
    cloud: { instanceTemplateId: "i-cloud", valueTemplateId: "v-cloud" },
    cloud_child: { instanceTemplateId: "i-child" },
  });
  // A policy not made from a template names none.
  assert.equal(slotsOfInstance({ settingDefinitionId: "x", settingInstanceTemplateReference: null, simpleSettingValue: { value: 1 } }).size, 0);
});

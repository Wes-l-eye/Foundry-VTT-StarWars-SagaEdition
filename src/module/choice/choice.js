import { GM_BONUSES, lightsaberForms, skills } from '../constants.js';
import { getInheritableAttribute } from '../attribute-helper.js';
import { fullJoin, innerJoin } from '../util.js';

function skipFirstLevelChoice(choice, context) {
  return choice.isFirstLevel && !context.isFirstLevel;
}

function resolveActionsFromChoice(choice, item, choiceAnswer, options) {
  let items = [];
  if (choice.showSelectionInName) {
    item.setChoice(choiceAnswer);
  }
  if (choice.type === 'INTEGER') {
    item.setPayload(choiceAnswer, choice.payload);
  } else {
    let selectedChoice = options.find((option) => option.name === choiceAnswer);
    if (selectedChoice) {
      if (selectedChoice.payload) {
        selectedChoice.payloads = selectedChoice.payloads || {};
        selectedChoice.payloads['payload'] = selectedChoice.payload;
      }

      if (selectedChoice.payloads && Object.values(selectedChoice.payloads).length > 0) {
        Object.entries(selectedChoice.payloads).forEach((payload) => {
          item.setPayload(payload[1], payload[0]);
        });
      }
      if (selectedChoice.providedItems && selectedChoice.providedItems.length > 0) {
        items = selectedChoice.providedItems;
      }
      if (selectedChoice.attributes && Object.values(selectedChoice.attributes).length > 0) {
        Object.values(selectedChoice.attributes).forEach((attr) => {
          let index = Math.max(Object.keys(item.system.attributes)) + 1;
          item.system.attributes[index] = attr;
        });
      }
    }
  }
  return items;
}

/**
 * if no choices exist > success empty item array
 * if no choices can be run > success empty array
 * if a choice is exited from > fail
 * if choices run, modify parent item and return future items
 *
 * @param item
 * @param context
 * @returns {Promise<{success: boolean, items: []}>}
 */
export async function activateChoices(item, context) {
  let actor = context.actor;
  let choices = item.system.choices;
  if (choices?.length === 0) {
    return { success: true, items: [] };
  }
  let items = [];
  for (let choice of choices ? choices : []) {
    if (skipFirstLevelChoice(choice, context)) {
      continue;
    }

    let greetingString;
    let content;
    let options;
    if ('INTEGER' === choice.type) {
      greetingString = choice.description;
      content = `<p>${greetingString}</p>`;
      content += `<input class="choice" type="number" data-option-key="">`;
    } else {
      options = explodeOptions(choice.options, actor);

      let preprogrammedAnswer = options.find(
        (o) => context.itemAnswers && (context.itemAnswers.includes(o.name) || context.itemAnswers.includes(o.value)),
      );
      if (!preprogrammedAnswer) {
        preprogrammedAnswer = options.find(
          (o) =>
            context.generalAnswers &&
            (context.generalAnswers.includes(o.name) || context.generalAnswers.includes(o.value)),
        );
      }
      if (preprogrammedAnswer) {
        items.push(...resolveActionsFromChoice(choice, item, preprogrammedAnswer.name, options));
        continue;
      } else {
        console.log(choice.options, context, item);
      }

      let optionString = '';
      if (options.length === 0) {
        greetingString = choice.noOptions ? choice.noOptions : choice.description;
      } else if (options.length === 1) {
        greetingString = choice.oneOption ? choice.oneOption : choice.description;
        optionString = `<div class="choice">${options[0].name}</div>`;
      } else {
        greetingString = choice.description;

        for (let option of Object.values(options)) {
          optionString += `<option value="${option.name}"${option.isDefault ? ' selected' : ''}>${
            option.name
          }</option>`;
        }

        if (optionString !== '') {
          optionString = `<div><select class="choice">${optionString}</select></div>`;
        }
      }

      content = `<p>${greetingString}</p>`;

      let availableSelections = choice.availableSelections ? choice.availableSelections : 1;

      for (let i = 0; i < availableSelections; i++) {
        content += optionString;
      }
    }

    let response = await Dialog.prompt({
      title: greetingString,
      content: content,
      rejectClose: async (html) => {
        return false;
      },
      callback: async (html) => {
        let find = html.find('.choice');
        let items = [];
        for (let foundElement of find) {
          if (!foundElement) {
            return;
          }
          let elementValue = foundElement.value || foundElement.innerText;
          items.push(...resolveActionsFromChoice(choice, item, elementValue, options));
        }

        return { success: true, items };
      },
    });

    if (response === false) {
      return { success: false, items: [] };
    }
    items.push(...response.items);
  }
  return { success: true, items };
}

function explodeOptions(options, actor) {
  if (!Array.isArray(options)) {
    let resolvedOptions = [];
    for (let [key, value] of Object.entries(options)) {
      value.name = value.name || key;
      resolvedOptions.push(value);
    }
    options = resolvedOptions;
  }

  let resolvedOptions = [];
  for (let value of options) {
    let key = value.name;
    let destination = Object.keys(value).find((destination) => destination.startsWith('payload'));
    if (key === 'AVAILABLE_GM_BONUSES') {
      for (let bonus of GM_BONUSES) {
        let deepCopy = { key: bonus.key, value: bonus.value };
        resolvedOptions.push({ name: bonus.display, attributes: [deepCopy] });
      }
    } else if (key === 'AVAILABLE_EXOTIC_WEAPON_PROFICIENCY') {
      let weaponProficiencies = getInheritableAttribute({
        entity: actor,
        attributeKey: 'weaponProficiency',
        reduce: 'VALUES',
      });
      for (let weapon of game.generated.exoticWeapons) {
        if (!weaponProficiencies.includes(weapon)) {
          resolvedOptions.push({ name: weapon, abilities: [], items: [], payload: weapon });
        }
      }
    } else if (key === 'AVAILABLE_WEAPON_FOCUS') {
      resolvedOptions.push(...resolveOptions(actor, 'weaponFocus', 'weaponProficiency'));
    } else if (key === 'AVAILABLE_WEAPON_SPECIALIZATION') {
      resolvedOptions.push(...resolveOptions(actor, 'weaponSpecialization', 'weaponFocus'));
    } else if (key === 'AVAILABLE_GREATER_WEAPON_SPECIALIZATION') {
      resolvedOptions.push(
        ...resolveOptions(actor, 'greaterWeaponSpecialization', ['greaterWeaponFocus', 'weaponSpecialization']),
      );
    } else if (key === 'AVAILABLE_DISARMING_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'disarmingAttack', 'weaponSpecialization'));
    } else if (key === 'AVAILABLE_GREATER_WEAPON_FOCUS') {
      resolvedOptions.push(...resolveOptions(actor, 'greaterWeaponFocus', 'weaponProficiency'));
    } else if (key === 'AVAILABLE_WEAPON_PROFICIENCIES') {
      let weaponProficiencies = getInheritableAttribute({
        entity: actor,
        attributeKey: 'weaponProficiency',
        reduce: 'VALUES',
      });
      for (let weapon of [
        'Simple Weapons',
        'Pistols',
        'Rifles',
        'Lightsabers',
        'Heavy Weapons',
        'Advanced Melee Weapons',
      ]) {
        if (!weaponProficiencies.includes(weapon)) {
          resolvedOptions.push({
            name: weapon.titleCase(),
            abilities: [],
            items: [],
            payload: weapon.titleCase(),
          });
        }
      }
    } else if (key === 'UNFOCUSED_SKILLS') {
      let skillFocuses = getInheritableAttribute({
        entity: actor,
        attributeKey: 'skillFocus',
        reduce: 'VALUES',
      });
      for (let skill of skills) {
        if (!skillFocuses.includes(skill)) {
          resolvedOptions.push({
            name: skill.titleCase(),
            abilities: [],
            items: [],
            payload: skill.titleCase(),
          });
        }
      }
    } else if (key === 'AVAILABLE_SKILL_FOCUS') {
      let skillFocuses = getInheritableAttribute({
        entity: actor,
        attributeKey: 'skillFocus',
        reduce: 'VALUES_TO_LOWERCASE',
      });
      for (let skill of actor.trainedSkills) {
        if (!skillFocuses.includes(skill.key)) {
          resolvedOptions.push({
            name: skill.key.titleCase(),
            abilities: [],
            items: [],
            payload: skill.key.titleCase(),
          });
        }
      }
    } else if (key === 'AVAILABLE_SKILL_MASTERY') {
      resolvedOptions.push(...resolveOptions(actor, 'skillMastery', 'skillFocus', { excluded: ['Use The Force'] }));
    } else if (key === 'AVAILABLE_DOUBLE_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'doubleAttack', 'weaponProficiency'));
    } else if (key === 'AVAILABLE_DEVASTATING_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'devastatingAttack', 'weaponProficiency'));
    } else if (key === 'AVAILABLE_GREATER_DEVASTATING_ATTACK') {
      resolvedOptions.push(
        ...resolveOptions(actor, 'greaterDevastatingAttack', ['devastatingAttack', 'greaterWeaponFocus']),
      );
    } else if (key === 'AVAILABLE_TRIPLE_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'tripleAttack', 'doubleAttack'));
    } else if (key === 'AVAILABLE_SAVAGE_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'savageAttack', 'doubleAttack'));
    } else if (key === 'AVAILABLE_RELENTLESS_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'relentlessAttack', 'doubleAttack'));
    } else if (key === 'AVAILABLE_AUTOFIRE_SWEEP') {
      resolvedOptions.push(...resolveOptions(actor, 'autofireSweep', 'weaponFocus'));
    } else if (key === 'AVAILABLE_AUTOFIRE_ASSAULT') {
      resolvedOptions.push(...resolveOptions(actor, 'autofireAssault', 'weaponFocus'));
    } else if (key === 'AVAILABLE_HALT') {
      resolvedOptions.push(...resolveOptions(actor, 'halt', 'weaponFocus'));
    } else if (key === 'AVAILABLE_PENETRATING_ATTACK') {
      resolvedOptions.push(...resolveOptions(actor, 'penetratingAttack', 'weaponFocus'));
    } else if (key === 'AVAILABLE_RETURN_FIRE') {
      resolvedOptions.push(...resolveOptions(actor, 'returnFire', 'weaponFocus'));
    } else if (key === 'AVAILABLE_CRITICAL_STRIKE') {
      resolvedOptions.push(...resolveOptions(actor, 'criticalStrike', 'weaponFocus'));
    } else if (key === 'AVAILABLE_LIGHTSABER_FORMS') {
      for (let form of lightsaberForms) {
        if (!actor.talents.map((t) => t.name).includes(form)) {
          resolvedOptions.push({ name: form, abilities: [], items: [], payload: form });
        }
      }
    } else {
      resolvedOptions.push(value);
    }
  }
  return resolvedOptions;
}

/**
 *
 * @param actor
 * @param excludingKey {string|[string]} gets attributes to exclude from inclusion list.  when multiple keys are provided a full join is done.
 * @param includeKey {string|[string]} gets attributes to include.  when multiple keys are provided this will be an inner join of attribute queries
 * @param options
 * @param options.excluded additional excluded options
 * @param options.included additional included options
 * @returns {[]}
 */
function resolveOptions(actor, excludingKey, includeKey, options = {}) {
  let resolvable = [];
  excludingKey = excludingKey ? excludingKey : [];
  includeKey = includeKey ? includeKey : [];

  excludingKey = Array.isArray(excludingKey) ? excludingKey : [excludingKey];
  includeKey = Array.isArray(includeKey) ? includeKey : [includeKey];

  let excluded = fullJoin(
    ...excludingKey.map((key) =>
      getInheritableAttribute({
        entity: actor,
        attributeKey: key,
        reduce: 'VALUES',
      }),
    ),
  );
  excluded.push(...(options?.excluded || []));
  let included = innerJoin(
    ...includeKey.map((key) =>
      getInheritableAttribute({
        entity: actor,
        attributeKey: key,
        reduce: 'VALUES',
      }),
    ),
  );
  included.push(...(options?.included || []));
  for (let option of included) {
    if (!excluded.includes(option)) {
      resolvable.push({
        name: option.titleCase(),
        abilities: [],
        items: [],
        payloads: { payload: option.titleCase() },
      });
    }
  }
  return resolvable;
}

test();

function test() {
  console.log('running choice tests');
}

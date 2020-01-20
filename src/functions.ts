import {
  triggerReformation,
  calculateNewPositionMinCollision,
  reformatPositions
} from "position-functions";
import {
  findAsync,
  selectQueryBuilderAsync,
  createQueryBuilderAsync,
  updateByIdAsync,
  IModel
} from "typeorm-event-functions";
import {
  EntitySchema,
  ObjectType,
  FindConditions,
  DeepPartial,
  Brackets,
  SelectQueryBuilder,
  ObjectLiteral,
  OrderByCondition
} from "typeorm";
import { Optional, Some } from "optional-typescript";

export interface IPositionDataType {
  id: Optional<string>;
  position: Optional<number>;
}

export interface IModelPosition extends IModel {
  position: number;
}

export function compareFunction<T extends IPositionDataType>(a: T, b: T) {
  return a.position.valueOr(0) - b.position.valueOr(0);
}

export function sort<T extends IPositionDataType>({
  list,
  comparisonFunction
}: {
  list: T[];
  comparisonFunction?: (a: T, b: T) => number;
}): IPositionDataType[] {
  const func = comparisonFunction ? comparisonFunction : compareFunction;
  return list.sort(func);
}

export async function getFinalPositionAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  filterCondition,
  position,
  attemptsLeft = 10
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  filterCondition: FindConditions<A>;
  position: number;
  attemptsLeft?: number;
}): Promise<number> {
  if (attemptsLeft < 1) {
    throw new Error("Tried to find a non-conflicting solution too many times");
  }

  const existingPostEntryOrNone = Some(
    await (await selectQueryBuilderAsync({ target, where: filterCondition }))
      .andWhere(`position = ${position}`)
      .getOne()
  );

  if (existingPostEntryOrNone.hasValue) {
    const previousListEntryOrNone = Some(
      await (
        await selectQueryBuilderAsync({
          target,
          where: filterCondition
        })
      )
        .andWhere(`position < ${position}`)
        .orderBy("position", "DESC")
        .getOne()
    );
    const previousPosition = previousListEntryOrNone
      .map(a => a.position)
      .valueOr(0);
    const newPosition = calculateNewPositionMinCollision(
      previousPosition,
      position
    );
    return getFinalPositionAsync({
      target,
      createFromModel,
      filterCondition,
      position: newPosition,
      attemptsLeft: attemptsLeft - 1
    });
  }
  return position;
}

export async function reformatIfNeededAsync<
  A extends IModelPosition,
  B extends IPositionDataType,
  TEventResult,
  TReformEventResult
>({
  target,
  createFromModel,
  previousPosition,
  position,
  positionConstant,
  findConditions,
  sendUpdateEvent,
  sendReformationEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  previousPosition: number;
  position: number;
  positionConstant?: number;
  findConditions?: FindConditions<A>;
  sendUpdateEvent?:
    | ((entry: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
  sendReformationEvent?: () => TReformEventResult | Promise<TReformEventResult>;
}) {
  if (!triggerReformation(previousPosition, position, positionConstant)) {
    return;
  }
  const p = (
    await findAsync({
      target,
      createFromModel,
      findConditions
    })
  ).map(a => {
    return {
      id: a.id.valueOrFailure(),
      position: a.position.valueOrFailure()
    };
  });
  const reformattedPositions = reformatPositions(p);
  reformattedPositions.forEach(async value => {
    const tmp: DeepPartial<IModelPosition> = {
      position: value.position
    };
    await updateByIdAsync({
      target,
      id: value.id as string,
      elementToUpdate: tmp,
      createFromModel,
      sendEvent: sendUpdateEvent
    });
  });
  if (sendReformationEvent) {
    await sendReformationEvent();
  }
}

export interface IOrderByOptions {
  sort: string;
  order?: "ASC" | "DESC";
  nulls?: "NULLS FIRST" | "NULLS LAST";
}

function isOrderByOptions(
  arg: IOrderByOptions | OrderByCondition
): arg is IOrderByOptions {
  return arg.sort !== undefined;
}

export async function findElementAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  positionWhere,
  orderBy,
  filter
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  positionWhere: string | Brackets | ((qb: SelectQueryBuilder<A>) => string);
  orderBy?: IOrderByOptions | OrderByCondition;
  filter?:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<A>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
}): Promise<Optional<B>> {
  let qb = await (filter
    ? selectQueryBuilderAsync({ target, where: filter })
    : selectQueryBuilderAsync({
        target,
        where: positionWhere
      }));
  if (filter) qb = qb.andWhere(positionWhere);
  if (orderBy) {
    if (isOrderByOptions(orderBy)) {
      qb = qb.orderBy(orderBy.sort, orderBy.order, orderBy.nulls);
    } else qb = qb.orderBy(orderBy);
  }
  return Some(await qb.getOne()).map(createFromModel);
}

export async function findNextElementAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  position,
  filter
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  position: number;
  filter?:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<A>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
}): Promise<Optional<B>> {
  return findElementAsync({
    target,
    createFromModel,
    positionWhere: `position > ${position}`,
    orderBy: { sort: "position", order: "ASC" },
    filter
  });
}

export async function findPreviousElementAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  position,
  filter
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  position: number;
  filter?:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<A>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
}): Promise<Optional<B>> {
  return findElementAsync({
    target,
    createFromModel,
    positionWhere: `position < ${position}`,
    orderBy: { sort: "position", order: "DESC" },
    filter
  });
}

export async function findLastElementAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  filter
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  filter?:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<A>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
}) {
  const qb = await (filter
    ? selectQueryBuilderAsync({ target, where: filter })
    : createQueryBuilderAsync({ target }));
  return Some(await qb.orderBy("position", "DESC").getOne()).map(
    createFromModel
  );
}

export async function findFirstElementAsync<A extends IModelPosition, B>({
  target,
  createFromModel,
  filter
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  filter?:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<A>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
}) {
  const qb = await (filter
    ? selectQueryBuilderAsync({ target, where: filter })
    : createQueryBuilderAsync({ target }));
  return Some(await qb.orderBy("position", "ASC").getOne()).map(
    createFromModel
  );
}

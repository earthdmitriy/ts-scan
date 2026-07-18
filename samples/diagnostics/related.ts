export interface RelatedPerson {
	name: string;
}

/*error:related*/ export interface RelatedPerson {
	name: number;
}

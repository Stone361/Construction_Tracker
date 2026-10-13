package com.example.constructiontracker.domain;

import java.time.LocalDate;

/** 列表查询结果；id 标识 MyBatis 结果行，最后照片业务日由 SQL 聚合。 */
public record HouseListRow(Long id, House house, LocalDate lastPhotoBusinessDate) {
}
